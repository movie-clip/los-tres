import 'server-only';

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { FeedBytes, FeedFailure, FeedSourceRef } from './types';

// The one place in src/ that may call `fetch` or read a file (guardrail 2).
// It serves registered feed rows only: the caller passes a feed row, never a
// free URL or path. A feed URL can hold a network API key, so no message here
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

/** A feed whose source cannot be read. `code` is the report's `failure`. */
export class SourceError extends Error {
  readonly code: Extract<
    FeedFailure,
    'fetch_failed' | 'unsupported_url' | 'too_large' | 'redirect_refused'
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
 * `is_demo`, read from demo/feeds. Anything else is `unsupported_url`.
 *
 * Resolves once redirects are settled and a 2xx answer is in hand, so a refusal
 * (`unsupported_url`, `fetch_failed`, `redirect_refused`) is thrown here. The
 * returned bytes are read once; reading them throws `SourceError` with
 * `too_large` (over 50 MiB) or `fetch_failed` (idle or total timeout, dropped
 * connection).
 */
export async function readFeedSource(feed: FeedSourceRef): Promise<FeedBytes> {
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
