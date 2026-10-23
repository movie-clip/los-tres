import 'server-only';

import { Readable, pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';

import { SourceError } from './source';
import { FeedFormatError, type FeedBytes } from './types';

// Bytes to text. The only importer of `node:zlib`. Gzip is recognised by its
// magic bytes 1f 8b at offset 0 and by nothing else: not Content-Type, not
// Content-Encoding, not a URL extension (affiliate URLs are API endpoints). Zip
// is not supported: its bytes fall through and fail as `invalid_header`.

/** Gunzip output allowed per feed. A small gzip of zeros must not fill memory. */
const MAX_INFLATED_BYTES = 512 * 1024 * 1024;
const GZIP_MAGIC = [0x1f, 0x8b] as const;

/**
 * The feed's text, chunk by chunk: inflated first when the bytes start with the
 * gzip magic, then decoded as UTF-8 with a leading BOM dropped. A multi-byte
 * character split between chunks is held until it completes. Throws
 * `FeedFormatError('invalid_gzip')` for gzip that does not inflate and
 * `FeedFormatError('too_large')` past the inflated cap; a `SourceError` from
 * the byte source passes through. Ending the iteration early releases the
 * source.
 */
export async function* decodeFeed(bytes: FeedBytes): AsyncGenerator<string> {
  const source = bytes[Symbol.asyncIterator]();
  try {
    const head = await peek(source, GZIP_MAGIC.length);
    const body = replay(head, source);
    const raw = isGzip(head) ? inflate(body) : body;

    const decoder = new TextDecoder('utf-8');
    for await (const chunk of raw) {
      const text = decoder.decode(chunk, { stream: true });
      if (text !== '') yield text;
    }
    const rest = decoder.decode();
    if (rest !== '') yield rest;
  } finally {
    await source.return?.();
  }
}

function isGzip(head: Uint8Array): boolean {
  return head.byteLength >= GZIP_MAGIC.length && GZIP_MAGIC.every((byte, i) => head[i] === byte);
}

/** Reads from the source until `count` bytes are in hand or it ends. */
async function peek(source: AsyncIterator<Uint8Array>, count: number): Promise<Uint8Array> {
  let head = new Uint8Array(0);
  while (head.byteLength < count) {
    const next = await source.next();
    if (next.done) break;
    const joined = new Uint8Array(head.byteLength + next.value.byteLength);
    joined.set(head);
    joined.set(next.value, head.byteLength);
    head = joined;
  }
  return head;
}

/** The peeked bytes again, then the rest of the source. */
async function* replay(head: Uint8Array, source: AsyncIterator<Uint8Array>): AsyncGenerator<Uint8Array> {
  if (head.byteLength > 0) yield head;
  for (;;) {
    const next = await source.next();
    if (next.done) return;
    yield next.value;
  }
}

async function* inflate(body: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const gunzip = createGunzip();
  // The source is fed through a pipeline so that an error in it, and a stop
  // here, both tear the whole chain down. Errors are read from `gunzip` below.
  pipeline(Readable.from(body), gunzip, () => undefined);
  let inflated = 0;
  try {
    for await (const chunk of gunzip as AsyncIterable<Uint8Array>) {
      inflated += chunk.byteLength;
      if (inflated > MAX_INFLATED_BYTES) throw new FeedFormatError('too_large');
      yield chunk;
    }
  } catch (error) {
    if (error instanceof SourceError || error instanceof FeedFormatError) throw error;
    throw new FeedFormatError('invalid_gzip');
  } finally {
    gunzip.destroy();
  }
}
