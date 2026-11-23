import 'server-only';

import { constants, createReadStream } from 'node:fs';
import { lstat, open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { isCatalogueFileName } from '../catalogue-file-name';
import type { FeedBytes, FeedFailure, FeedSourceRef } from './types';

// The one place in src/ that may call `fetch` or read a file (guardrail 2).
// It serves registered feed rows only: the caller passes a feed row, never a
// free URL or path. It is also the only place that names the one catalogue
// folder (S3.7): a catalogue-file feed holds a bare file name, never a path, and
// no command argument or request can name another folder. The same holds for the
// one collected folder (S12.2): a collected-file feed reads only there, a
// catalogue-file feed never does, and both use one reader and one name rule. A feed URL can hold a network API key, so no message here
// carries it, and the underlying error is dropped on purpose (TD-36). The same
// goes for a redirect target (`Location`): it is never logged or put in an error.

/** From each request to its response headers. */
const HEADER_TIMEOUT_MS = 30_000;
/** Waiting for the next body chunk. Time spent by the importer between chunks does not count. */
const IDLE_TIMEOUT_MS = 60_000;
/** From the first request to the last byte, importer time included. */
const TOTAL_TIMEOUT_MS = 15 * 60_000;
/** Bytes as served (after any transport decoding), before gzip inflation. */
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEMO_SCHEME = 'demo-feed:';
const DEMO_FILE = /^[a-z0-9-]+\.(csv|xml)(\.gz)?$/;
/** The one folder a catalogue-file feed reads, at the repo root (and in the container's /app). */
const CATALOGUE_FOLDER = 'catalogue-files';
/** The one folder a collected-file feed reads (S12.2), at the repo root (and in the container's /app). */
const COLLECTED_FOLDER = 'collected-files';

/** A feed whose source cannot be read. `code` is the report's `failure`. */
export class SourceError extends Error {
  readonly code: Extract<
    FeedFailure,
    | 'fetch_failed'
    | 'unsupported_url'
    | 'too_large'
    | 'redirect_refused'
    | 'file_name_refused'
    | 'file_not_found'
    | 'file_refused'
  >;

  constructor(code: SourceError['code']) {
    super(code);
    this.name = 'SourceError';
    this.code = code;
  }
}

/**
 * Opens the bytes of one registered feed, as served: maybe gzip, maybe CSV or
 * XML (decode.ts and records.ts tell). Allowed: an `https:` URL, fetched with
 * a timeout and a size cap, following at most 5 redirects and only to https on
 * the feed URL's own host; and `demo-feed:<name>.csv|xml[.gz]` for a feed marked
 * `is_demo`, read from demo/feeds; and, for a `catalogue_file` feed, the file
 * its stored name gives in the catalogue folder (`readCatalogueFile`); and, for a
 * `collected_file` feed, the file its stored name gives in the collected folder,
 * by the same reader and the same name rule (S12.2). Anything else is
 * `unsupported_url`. A feed's kind picks its branch, so a file feed never reaches
 * demo/feeds, the network or the other kind's folder, and the other kinds never
 * reach either folder.
 *
 * `options.catalogueDir` and `options.collectedDir` replace the two folders, for
 * tests only: the importer, the CLI and every command call this without them.
 *
 * Resolves once redirects are settled and a 2xx answer is in hand, so a refusal
 * (`unsupported_url`, `fetch_failed`, `redirect_refused`) is thrown here. The
 * returned bytes are read once; reading them throws `SourceError` with
 * `too_large` (over 50 MiB) or `fetch_failed` (idle or total timeout, dropped
 * connection).
 */
export async function readFeedSource(
  feed: FeedSourceRef,
  options: { catalogueDir?: string; collectedDir?: string } = {},
): Promise<FeedBytes> {
  if (feed.sourceType === 'catalogue_file') {
    if (feed.isDemo) throw new SourceError('unsupported_url');
    return readCatalogueFile(
      feed.url,
      options.catalogueDir ?? path.resolve(process.cwd(), CATALOGUE_FOLDER),
    );
  }
  if (feed.sourceType === 'collected_file') {
    if (feed.isDemo) throw new SourceError('unsupported_url');
    return readCatalogueFile(
      feed.url,
      options.collectedDir ?? path.resolve(process.cwd(), COLLECTED_FOLDER),
    );
  }

  if (feed.url.startsWith(DEMO_SCHEME)) {
    const name = feed.url.slice(DEMO_SCHEME.length);
    if (!feed.isDemo || !DEMO_FILE.test(name)) throw new SourceError('unsupported_url');
    const file = path.resolve(process.cwd(), 'demo/feeds', name);
    const found = await stat(file).catch(() => null);
    if (!found?.isFile()) throw new SourceError('fetch_failed');
    return capWire(createReadStream(file));
  }

  let start: URL;
  try {
    start = new URL(feed.url);
  } catch {
    throw new SourceError('unsupported_url');
  }
  if (start.protocol !== 'https:') throw new SourceError('unsupported_url');

  const control = new AbortController();
  const total = setTimeout(() => control.abort(), TOTAL_TIMEOUT_MS);
  total.unref();
  let response: Response;
  try {
    response = await followRedirects(start, control);
  } catch (error) {
    clearTimeout(total);
    throw error instanceof SourceError ? error : new SourceError('fetch_failed');
  }
  // `followRedirects` only returns a response that has a body.
  return capWire(bodyChunks(response.body as ReadableStream<Uint8Array>, control, total));
}

/**
 * One file of a feed-file folder (the catalogue folder, or the collected folder for
 * a collected-file feed), by the exact name a feed row stores. Every
 * refusal is a `SourceError` with a fixed code and nothing else: no path, no
 * name and no system error reaches a message or a log (guardrail 5).
 *
 * The name is checked by the shared rule first, so nothing is touched on disk
 * for a bad name. The folder and the file are then looked up as exact entries
 * (a case-insensitive host and the case-sensitive container agree), a link of
 * any kind is refused, and the file is opened without following links and
 * checked to be the very file that was inspected.
 */
async function readCatalogueFile(name: string, dir: string): Promise<FeedBytes> {
  if (!isCatalogueFileName(name)) throw new SourceError('file_name_refused');

  const folder = await lstat(dir).catch(() => null);
  if (!folder) throw new SourceError('file_not_found');
  if (folder.isSymbolicLink()) throw new SourceError('file_refused');
  if (!folder.isDirectory()) throw new SourceError('file_not_found');

  const entries = await readdir(dir).catch(() => null);
  if (!entries?.includes(name)) throw new SourceError('file_not_found');

  const file = path.join(dir, name);
  const inspected = await lstat(file, { bigint: true }).catch(() => null);
  if (!inspected) throw new SourceError('file_not_found');
  if (inspected.isSymbolicLink() || !inspected.isFile()) throw new SourceError('file_refused');

  // O_NOFOLLOW exists on POSIX only; on Windows the lstat above is the guard.
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
    (error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code;
      throw new SourceError(
        code === 'ENOENT' ? 'file_not_found' : code === 'ELOOP' ? 'file_refused' : 'fetch_failed',
      );
    },
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== inspected.dev || opened.ino !== inspected.ino) {
      throw new SourceError('file_refused');
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error instanceof SourceError ? error : new SourceError('fetch_failed');
  }
  // The stream owns the handle from here and closes it when it ends or is destroyed.
  return capWire(handle.createReadStream());
}

/**
 * GET with `redirect: 'manual'`. A 3xx is followed only to an `https:` URL
 * whose `host` (hostname and port) equals the feed URL's, at most 5 times; any
 * other target, and a 6th hop, is `redirect_refused`. A 3xx with no usable
 * `Location`, and a non-2xx answer, is `fetch_failed`. Returns a 2xx response
 * that has a body.
 */
async function followRedirects(start: URL, control: AbortController): Promise<Response> {
  let current = start;
  for (let redirects = 0; ; ) {
    const headerTimer = setTimeout(() => control.abort(), HEADER_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, { redirect: 'manual', signal: control.signal });
    } finally {
      clearTimeout(headerTimer);
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await discard(response);
      if (!location) throw new SourceError('fetch_failed');
      redirects += 1;
      if (redirects > MAX_REDIRECTS) throw new SourceError('redirect_refused');
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new SourceError('fetch_failed');
      }
      if (next.protocol !== 'https:' || next.host !== start.host) {
        throw new SourceError('redirect_refused');
      }
      current = next;
      continue;
    }

    if (!response.ok || !response.body) {
      await discard(response);
      throw new SourceError('fetch_failed');
    }
    return response;
  }
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release.
  }
}

/**
 * The response body chunk by chunk. Each wait for a chunk has an idle timeout;
 * `total` is the whole-read timer, cleared when reading ends for any reason.
 * Ending early (a cap, a consumer error) cancels the body.
 */
async function* bodyChunks(
  body: ReadableStream<Uint8Array>,
  control: AbortController,
  total: ReturnType<typeof setTimeout>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const idle = setTimeout(() => control.abort(), IDLE_TIMEOUT_MS);
      const chunk = await reader.read().finally(() => clearTimeout(idle));
      if (chunk.done) return;
      yield chunk.value;
    }
  } finally {
    clearTimeout(total);
    await reader.cancel().catch(() => undefined);
  }
}

/** Counts the bytes as served and stops at the wire cap. Any other failure is `fetch_failed`. */
async function* capWire(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let served = 0;
  try {
    for await (const chunk of chunks) {
      served += chunk.byteLength;
      if (served > MAX_BODY_BYTES) throw new SourceError('too_large');
      yield chunk;
    }
  } catch (error) {
    throw error instanceof SourceError ? error : new SourceError('fetch_failed');
  }
}
