// A small RFC 4180 reader (D-2 Q-1; no dependency). Incremental: text arrives
// in chunks of any size, split anywhere (inside a quote, between a CR and its
// LF), and records come out as soon as they are complete.

import { FeedFormatError } from './types';

const QUOTE = '"';
const COMMA = ',';
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

/** Longest record in progress, in characters: far past any feed row, well short of memory. */
const MAX_RECORD_CHARS = 16 * 1024 * 1024;

/**
 * Reads CSV text pushed in chunks. Handles a leading BOM, comma separators,
 * double-quoted fields with doubled quotes, CRLF and LF line ends, and newlines
 * inside quotes. Blank lines are skipped. A ragged record is returned as it is.
 * An unterminated quote runs to the end of the text.
 */
export class CsvReader {
  private done: string[][] = [];
  private record: string[] = [];
  private field = '';
  private inQuotes = false;
  /** In quotes and the last character was a quote: a closing quote, or half of `""`. */
  private quotePending = false;
  /** The last character was a CR, so a following LF belongs to the same line end. */
  private crPending = false;
  private hasContent = false;
  private started = false;
  /** Characters in the record in progress, so one runaway record fails instead of filling memory. */
  private size = 0;

  /**
   * Feeds the next chunk and returns the records it completed. Throws
   * `FeedFormatError('too_large')` when one record outgrows MAX_RECORD_CHARS.
   */
  push(text: string): string[][] {
    let source = text;
    if (!this.started && source.length > 0) {
      this.started = true;
      if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
    }

    // `run` is where a stretch of plain characters began, or -1. Plain stretches
    // are appended whole, not one character at a time, so a long field costs
    // one string and not one rope node per character.
    let run = -1;
    const flush = (end: number): void => {
      if (run === -1) return;
      this.field += source.slice(run, end);
      this.size += end - run;
      run = -1;
      if (this.size > MAX_RECORD_CHARS) throw new FeedFormatError('too_large');
    };

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (this.crPending) {
        this.crPending = false;
        if (char === LF) continue;
      }
      if (this.quotePending) {
        this.quotePending = false;
        if (char === QUOTE) {
          this.field += QUOTE;
          this.size += 1;
          continue;
        }
        this.inQuotes = false;
      }
      const plain = this.inQuotes
        ? char !== QUOTE
        : char !== QUOTE && char !== COMMA && char !== LF && char !== CR;
      if (plain) {
        if (run === -1) run = i;
        if (!this.inQuotes) this.hasContent = true;
        continue;
      }
      flush(i);
      this.size += 1;
      this.special(char);
    }
    flush(source.length);
    return this.take();
  }

  /** Ends the text and returns the last record, if one is open. */
  end(): string[][] {
    this.quotePending = false;
    this.inQuotes = false;
    if (this.hasContent) this.endRecord();
    return this.take();
  }

  private take(): string[][] {
    const records = this.done;
    this.done = [];
    return records;
  }

  private endField(): void {
    this.record.push(this.field);
    this.field = '';
  }

  private endRecord(): void {
    this.endField();
    // A line with no characters at all is blank, not a record of one empty field.
    if (this.hasContent) this.done.push(this.record);
    this.record = [];
    this.hasContent = false;
    this.size = 0;
  }

  /** A quote, comma or line end seen outside a plain stretch. */
  private special(char: string): void {
    if (this.inQuotes) {
      // Only a quote is special inside quotes: closing, or half of a doubled one.
      this.quotePending = true;
    } else if (char === QUOTE) {
      this.inQuotes = true;
      this.hasContent = true;
    } else if (char === COMMA) {
      this.endField();
      this.hasContent = true;
    } else if (char === LF) {
      this.endRecord();
    } else {
      this.endRecord();
      this.crPending = true;
    }
  }
}

/** Parses a whole CSV text into records of fields. */
export function parseCsv(text: string): string[][] {
  const reader = new CsvReader();
  return [...reader.push(text), ...reader.end()];
}

/** The records of CSV text that arrives in chunks, one at a time as they complete. */
export async function* csvRecords(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  const reader = new CsvReader();
  for await (const chunk of chunks) yield* reader.push(chunk);
  yield* reader.end();
}
