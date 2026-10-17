import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { FeedFailure, FeedSourceRef } from './types';

// The one place in src/ that may call `fetch` or read a file (guardrail 2).
// It serves registered feed rows only: the caller passes a feed row, never a
// free URL or path. A feed URL can hold a network API key, so no message here
// carries it, and the underlying error is dropped on purpose (TD-36).

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const DEMO_SCHEME = 'demo-feed:';
const DEMO_FILE = /^[a-z0-9-]+\.csv$/;

/** A feed whose source cannot be read. `code` is the report's `failure`. */
export class SourceError extends Error {
  readonly code: Extract<FeedFailure, 'fetch_failed' | 'unsupported_url'>;

  constructor(code: SourceError['code']) {
    super(code);
    this.name = 'SourceError';
    this.code = code;
  }
}

/**
 * Reads the CSV text of one registered feed. Allowed: an `https:` URL, fetched
 * with a timeout and a size cap; and `demo-feed:<name>.csv` for a feed marked
 * `is_demo`, read from demo/feeds. Anything else is `unsupported_url`.
 */
export async function readFeedSource(feed: FeedSourceRef): Promise<string> {
  if (feed.url.startsWith(DEMO_SCHEME)) {
    const name = feed.url.slice(DEMO_SCHEME.length);
    if (!feed.isDemo || !DEMO_FILE.test(name)) throw new SourceError('unsupported_url');
    try {
      return await readFile(path.resolve(process.cwd(), 'demo/feeds', name), 'utf8');
    } catch {
      throw new SourceError('fetch_failed');
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(feed.url);
  } catch {
    throw new SourceError('unsupported_url');
  }
  if (parsed.protocol !== 'https:') throw new SourceError('unsupported_url');

  try {
    const response = await fetch(parsed, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok || !response.body) throw new SourceError('fetch_failed');
    return await readCapped(response.body);
  } catch {
    throw new SourceError('fetch_failed');
  }
}

async function readCapped(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new SourceError('fetch_failed');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
