import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

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

/** One feed row for the generators below; every key is a canonical column. */
export type FeedRow = Partial<
  Record<'id' | 'title' | 'price' | 'url' | 'brand' | 'ean' | 'currency' | 'fitment', string>
>;

const ROW_COLUMNS = ['id', 'title', 'price', 'url', 'brand', 'ean', 'currency'] as const;
const ROW_COLUMNS_WITH_FITMENT = [...ROW_COLUMNS, 'fitment'] as const;

/**
 * The rows as CSV text (header first). Values must not need quoting. The
 * `fitment` column is written only when some row defines `fitment`, so a caller
 * that never sets it keeps a feed with no fitment column (S5.6, AC 6, 7).
 */
export function csvOf(rows: FeedRow[]): string {
  const columns = rows.some((row) => row.fitment !== undefined) ? ROW_COLUMNS_WITH_FITMENT : ROW_COLUMNS;
  const lines = rows.map((row) => columns.map((column) => row[column] ?? '').join(','));
  return `${columns.join(',')}\n${lines.join('\n')}\n`;
}

/** The same rows as an XML document with one `product` element per row; an undefined key writes no element. */
export function xmlOf(rows: FeedRow[]): string {
  const products = rows.map((row) => {
    const children = ROW_COLUMNS_WITH_FITMENT.filter((column) => row[column] !== undefined)
      .map((column) => `<${column}>${row[column]}</${column}>`)
      .join('');
    return `<product>${children}</product>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<products>\n${products.join('\n')}\n</products>\n`;
}

/** Gzip of the text or bytes, made in the test so no binary is committed. */
export function gzipOf(content: string | Uint8Array): Uint8Array {
  return gzipSync(typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
}

/**
 * A byte source that records how many of its chunks were pulled and whether it
 * was released early. `pulled` counts chunks handed to the consumer; `released`
 * is true once the consumer stopped before the end.
 */
export function lazyBytes(chunks: () => Iterable<Uint8Array>): {
  bytes: FeedBytes;
  state: { pulled: number; released: boolean; finished: boolean };
} {
  const state = { pulled: 0, released: false, finished: false };
  async function* generate(): FeedBytes {
    try {
      for (const chunk of chunks()) {
        state.pulled += 1;
        yield chunk;
      }
      state.finished = true;
    } finally {
      if (!state.finished) state.released = true;
    }
  }
  return { bytes: generate(), state };
}
