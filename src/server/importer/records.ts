import 'server-only';

import { csvRecords } from './csv';
import { decodeFeed } from './decode';
import type { FeedBytes } from './types';
import { CANONICAL_COLUMNS } from './validate';
import { xmlRecords } from './xml';

// Bytes to records: gzip and text decoding (decode.ts), format detection, then
// the CSV or XML reader. Nothing here holds the whole feed: one chunk and one
// record in progress.

export type FeedRecords = {
  format: 'csv' | 'xml';
  /** CSV: the first record, `null` for a file with no record. XML: CANONICAL_COLUMNS. */
  header: string[] | null;
  /** The data records, numbered as `RejectedRow.record` is: the first is 2. */
  records: AsyncIterable<{ record: number; cells: string[] }>;
  /**
   * Releases the byte source (cancels the download). Safe to call at any time
   * and more than once; the caller calls it when it stops with the records,
   * including when it never reads them.
   */
  close(): Promise<void>;
};

const NOT_SPACE = /[^ \t\r\n]/;
/** Leading whitespace read while looking for the first character. A feed with more is CSV. */
const MAX_SNIFF_CHARS = 64 * 1024;

/**
 * Detects the format and opens the records. After gzip and the BOM, the first
 * character that is not ASCII whitespace decides: `<` is XML, anything else
 * (including nothing) is CSV. For CSV the header is read here, so a feed with
 * no header is known before anything is written. Throws what `decodeFeed` and
 * the CSV reader throw (`SourceError`, `FeedFormatError`); the byte source is
 * released before it throws.
 */
export async function openRecords(bytes: FeedBytes): Promise<FeedRecords> {
  const text = decodeFeed(bytes);
  const close = async (): Promise<void> => {
    try {
      await text.return(undefined);
    } catch {
      // Nothing left to release.
    }
  };

  try {
    let head = '';
    let first = -1;
    while (first === -1 && head.length < MAX_SNIFF_CHARS) {
      const next = await text.next();
      if (next.done) break;
      head += next.value;
      first = head.search(NOT_SPACE);
    }
    const chars = replay(head, text);

    if (first !== -1 && head[first] === '<') {
      return { format: 'xml', header: [...CANONICAL_COLUMNS], records: numbered(xmlRecords(chars)), close };
    }
    const rows = csvRecords(chars);
    const header = await rows.next();
    return {
      format: 'csv',
      header: header.done ? null : header.value,
      records: numbered(rows),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** The peeked text again, then the rest of the source. */
async function* replay(head: string, source: AsyncIterator<string>): AsyncGenerator<string> {
  if (head !== '') yield head;
  for (;;) {
    const next = await source.next();
    if (next.done) return;
    yield next.value;
  }
}

/** Numbers the data records from 2: the CSV header, or XML's implicit one, is record 1. */
async function* numbered(
  rows: AsyncIterable<string[]>,
): AsyncGenerator<{ record: number; cells: string[] }> {
  let record = 2;
  for await (const cells of rows) {
    yield { record, cells };
    record += 1;
  }
}
