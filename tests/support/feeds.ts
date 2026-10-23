import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ImportDeps } from '@/server/importer';
import type { FeedBytes } from '@/server/importer/types';

/** The text of one local fixture feed in tests/fixtures/feeds. Never a network read. */
export function readFeedFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), 'tests/fixtures/feeds', name), 'utf8');
}

/** The raw bytes of one local fixture feed, for a binary file such as a gzip. */
export function readFeedFixtureBytes(name: string): Uint8Array {
  return readFileSync(path.resolve(process.cwd(), 'tests/fixtures/feeds', name));
}

/**
 * Feed bytes as a source would serve them: the text as UTF-8, or the given
 * bytes, in one chunk or in chunks of `chunkSize` bytes (a chunk may end inside
 * a multi-byte character).
 */
export async function* bytesOf(content: string | Uint8Array, chunkSize?: number): FeedBytes {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const size = chunkSize === undefined || chunkSize < 1 ? Math.max(bytes.byteLength, 1) : chunkSize;
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, offset + size);
  }
}

/**
 * Importer dependencies that serve a feed from a local fixture. The feed row's
 * `url` is the fixture file name (for example `ean-first.csv`), so one import
 * can serve a different file per feed. Replaces the real source reader, so the
 * importer reads no network and no demo file.
 */
export const fixtureDeps: ImportDeps = {
  readSource: async (feed) => bytesOf(readFeedFixtureBytes(feed.url)),
};

/**
 * Importer dependencies that serve the given text or bytes per feed id; an
 * Error value is thrown from the reader.
 */
export function textDeps(byFeedId: Record<number, string | Uint8Array | Error>): ImportDeps {
  return {
    readSource: async (feed) => {
      const served = byFeedId[feed.id];
      if (served === undefined) throw new Error(`no text for feed ${feed.id}`);
      if (served instanceof Error) throw served;
      return bytesOf(served);
    },
  };
}
