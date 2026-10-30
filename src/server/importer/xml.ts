import 'server-only';

import { parser, type SAXParser } from 'sax';

import { FeedFormatError } from './types';
import { CANONICAL_COLUMNS } from './validate';

// XML feed text to canonical records. The only importer of the XML parser
// (`sax`, strict mode: its HTML-tolerant mode is never used). It tokenizes text
// that came through source.ts and does nothing else: no fetch, no file.
//
// The record rule is deliberately narrow until field mapping (S3.5) replaces it:
//   - any DOCTYPE is refused, so no DTD entity can exist; only the five
//     predefined and numeric references resolve;
//   - the record element is the first element met that has a direct child
//     element whose local name (prefix stripped, lower-cased) is `id`; every
//     later element with the same qualified name at the same depth is a record;
//   - a record's cells are its direct leaf children's text (CDATA included,
//     trimmed), keyed by lower-cased local name, so `g:price` is `price`; the
//     first of a repeated name wins; attributes and non-leaf children are ignored;
//   - cells come out as `string[]` in CANONICAL_COLUMNS order, '' when absent
//     (so an absent `fitment` element is an empty cell, as in CSV).
// "Met" is in document order of the child: the element whose `id` child opens
// first becomes the record element.

type Frame = {
  name: string;
  /** Leaf children met so far, by lower-cased local name. Absent when nobody needs them. */
  cells: Map<string, string> | null;
  /** The frame may be a leaf child of a collecting parent, so its text is kept. */
  collectsText: boolean;
  text: string;
  hasChildElement: boolean;
  isRecord: boolean;
};

const COLUMNS = new Set<string>(CANONICAL_COLUMNS);

/** Longest text of one cell, in characters: far past any feed field, well short of memory. */
const MAX_CELL_CHARS = 16 * 1024 * 1024;

function localName(qualified: string): string {
  return qualified.slice(qualified.indexOf(':') + 1).toLowerCase();
}

class RecordScanner {
  private readonly sax: SAXParser;
  private readonly stack: Frame[] = [];
  private ready: string[][] = [];
  private failed = false;
  private oversize = false;
  private recordName: string | null = null;
  private recordDepth = -1;
  private records = 0;
  /** Text and CDATA characters since the last tag, whether or not a cell keeps them. */
  private run = 0;

  constructor() {
    // `position` must stay on: sax checks its buffers (and hands over text in
    // pieces of at most 64 Ki characters) only while it tracks the position.
    this.sax = parser(true, { trim: false, normalize: false, xmlns: false, position: true });
    this.sax.onerror = () => {
      this.failed = true;
    };
    this.sax.ondoctype = () => {
      this.failed = true;
    };
    this.sax.onopentag = (tag) => {
      if (!this.failed) this.open(tag.name);
    };
    this.sax.ontext = (text) => {
      if (!this.failed) this.text(text);
    };
    this.sax.oncdata = (text) => {
      if (!this.failed) this.text(text);
    };
    this.sax.onclosetag = () => {
      if (!this.failed) this.close();
    };
  }

  /** Feeds the next text chunk. Throws `invalid_xml` on the first malformed byte. */
  write(chunk: string): void {
    this.check();
    try {
      this.sax.write(chunk);
    } catch {
      this.failed = true;
    }
    this.check();
  }

  /** Ends the document. Throws `invalid_xml` when it is cut short or held no record. */
  end(): void {
    this.check();
    try {
      this.sax.close();
    } catch {
      this.failed = true;
    }
    this.check();
    if (this.records === 0) throw new FeedFormatError('invalid_xml');
  }

  private check(): void {
    if (this.oversize) throw new FeedFormatError('too_large');
    if (this.failed) throw new FeedFormatError('invalid_xml');
  }

  /** The records completed since the last call. */
  take(): string[][] {
    const records = this.ready;
    this.ready = [];
    return records;
  }

  private open(qualified: string): void {
    this.run = 0;
    const parent = this.stack.at(-1);
    const depth = this.stack.length;
    if (parent) {
      parent.hasChildElement = true;
      parent.text = '';
      if (this.recordName === null && localName(qualified) === 'id') {
        this.recordName = parent.name;
        this.recordDepth = depth - 1;
        parent.isRecord = true;
      }
    }
    const isRecord = this.recordName === qualified && this.recordDepth === depth;
    this.stack.push({
      name: qualified,
      cells: this.recordName === null || isRecord ? new Map() : null,
      // Only the canonical columns are ever read, so no other text is kept.
      collectsText: parent?.cells != null && COLUMNS.has(localName(qualified)),
      text: '',
      hasChildElement: false,
      isRecord,
    });
  }

  private text(text: string): void {
    // Any run is bounded, not only the cells: one long text between tags must
    // fail fast and not be held whole.
    this.run += text.length;
    if (this.run > MAX_CELL_CHARS) {
      this.oversize = true;
      this.failed = true;
      return;
    }
    const frame = this.stack.at(-1);
    if (!frame?.collectsText) return;
    frame.text += text;
    if (frame.text.length > MAX_CELL_CHARS) {
      this.oversize = true;
      this.failed = true;
    }
  }

  private close(): void {
    this.run = 0;
    const frame = this.stack.pop();
    if (!frame) return;
    if (frame.isRecord) {
      this.records += 1;
      const cells = frame.cells ?? new Map<string, string>();
      this.ready.push(CANONICAL_COLUMNS.map((column) => cells.get(column) ?? ''));
      return;
    }
    const parent = this.stack.at(-1);
    if (parent?.cells && !frame.hasChildElement) {
      const key = localName(frame.name);
      if (COLUMNS.has(key) && !parent.cells.has(key)) parent.cells.set(key, frame.text.trim());
    }
  }
}

/**
 * The records of XML text that arrives in chunks, as `string[]` in
 * CANONICAL_COLUMNS order, one at a time as they complete. Throws
 * `FeedFormatError('invalid_xml')` for malformed XML, a DOCTYPE, or a document
 * with no record element.
 */
export async function* xmlRecords(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  const scanner = new RecordScanner();
  for await (const chunk of chunks) {
    scanner.write(chunk);
    yield* scanner.take();
  }
  scanner.end();
  yield* scanner.take();
}
