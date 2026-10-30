import { createGzip } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { decodeFeed } from '@/server/importer/decode';
import { openRecords } from '@/server/importer/records';
import { SourceError } from '@/server/importer/source';
import { FeedFormatError, type FeedBytes } from '@/server/importer/types';
import { CANONICAL_COLUMNS, readHeader, validateRow } from '@/server/importer/validate';
import { xmlRecords } from '@/server/importer/xml';

import { bytesOf, csvOf, gzipOf, lazyBytes, readFeedFixture, xmlOf } from '../support/feeds';

// Bytes to records: gzip by magic bytes, UTF-8, format sniffing, the XML
// record rule and the memory caps (D2 to D5). Pure: no database, no network.

async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

async function recordsOf(bytes: FeedBytes) {
  const opened = await openRecords(bytes);
  try {
    return { format: opened.format, header: opened.header, records: await drain(opened.records) };
  } finally {
    await opened.close();
  }
}

async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FeedFormatError || error instanceof SourceError) return error.code;
    throw error;
  }
  return 'none';
}

const ROWS = [
  { id: 'A-1', title: 'Filtro Ñandú', price: '10.00', url: 'https://shop-a.example/p/1' },
  { id: 'A-2', title: 'Taladro', price: '20.50', url: 'https://shop-a.example/p/2' },
];

/** `count` bytes of `byte`, as 64 KiB chunks, produced lazily. */
function* filler(byte: number, count: number): Generator<Uint8Array> {
  yield* repeated(new Uint8Array(64 * 1024).fill(byte), count);
}

/** `count` bytes made of the repeated `chunk`, the last one cut short. */
function* repeated(chunk: Uint8Array, count: number): Generator<Uint8Array> {
  for (let left = count; left > 0; left -= chunk.byteLength) {
    yield left >= chunk.byteLength ? chunk : chunk.subarray(0, left);
  }
}

/** The gzip of prefix + filler + suffix, compressed once up front. */
async function gzipFillerBytes(
  prefix: string,
  byte: number | Uint8Array,
  count: number,
  suffix = '',
): Promise<Uint8Array> {
  const gzip = createGzip({ level: 1 });
  const parts: Buffer[] = [];
  gzip.on('data', (part: Buffer) => parts.push(part));
  const done = new Promise<void>((resolve, reject) => {
    gzip.on('end', resolve);
    gzip.on('error', reject);
  });
  gzip.write(prefix);
  for (const chunk of typeof byte === 'number' ? filler(byte, count) : repeated(byte, count)) {
    if (!gzip.write(chunk)) await new Promise((resolve) => gzip.once('drain', resolve));
  }
  gzip.end(suffix);
  await done;
  return Buffer.concat(parts);
}

describe('format detection', () => {
  it('reads CSV by default, with the first record as the header', async () => {
    const result = await recordsOf(bytesOf(csvOf(ROWS)));
    expect(result.format).toBe('csv');
    expect(result.header?.slice(0, 4)).toEqual(['id', 'title', 'price', 'url']);
    expect(result.records.map((r) => r.record)).toEqual([2, 3]);
  });

  it('reads XML when the first character after a BOM and whitespace is <', async () => {
    const result = await recordsOf(bytesOf(`﻿ \r\n\t${xmlOf(ROWS)}`));
    expect(result.format).toBe('xml');
    expect(result.header).toEqual([...CANONICAL_COLUMNS]);
    expect(result.records.map((r) => r.record)).toEqual([2, 3]);
  });

  it('treats an empty feed as CSV with no header', async () => {
    const result = await recordsOf(bytesOf(''));
    expect(result).toMatchObject({ format: 'csv', header: null, records: [] });
  });

  it('treats more than 64 Ki chars of leading whitespace as CSV even when a < follows', async () => {
    const text = `${' '.repeat(70 * 1024)}${xmlOf(ROWS)}`;
    const opened = await openRecords(bytesOf(text, 64 * 1024));
    expect(opened.format).toBe('csv');
    await opened.close();
  });

  it('fails a feed of only whitespace, far past the sniff limit, as too_large without reading it all', async () => {
    // The sniff stops at 64 Ki chars; the CSV reader then meets one endless record.
    const { bytes, state } = lazyBytes(() => filler(0x20, 40 * 1024 * 1024));
    const total = 40 * 16;
    expect(await failureOf(() => openRecords(bytes))).toBe('too_large');
    expect(state.pulled).toBeLessThan(total);
    expect(state.released).toBe(true);
  });

  it('sends zip bytes down the CSV path, where they fail as an unreadable header, not as gzip', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const result = await recordsOf(bytesOf(zip));
    expect(result.format).toBe('csv');
  });
});

describe('gzip by magic bytes', () => {
  it('inflates gzip CSV and gzip XML to the same records as the plain text', async () => {
    const plainCsv = await recordsOf(bytesOf(csvOf(ROWS)));
    const plainXml = await recordsOf(bytesOf(xmlOf(ROWS)));
    const gzCsv = await recordsOf(bytesOf(gzipOf(csvOf(ROWS))));
    const gzXml = await recordsOf(bytesOf(gzipOf(xmlOf(ROWS))));
    expect(gzCsv.format).toBe('csv');
    expect(gzXml.format).toBe('xml');
    expect(gzCsv.records).toEqual(plainCsv.records);
    expect(gzXml.records).toEqual(plainXml.records);
  });

  it('accepts a multi-member gzip', async () => {
    const text = csvOf(ROWS);
    const cut = text.indexOf('\n') + 1;
    const joined = Buffer.concat([gzipOf(text.slice(0, cut)), gzipOf(text.slice(cut))]);
    const result = await recordsOf(bytesOf(joined));
    expect(result.records).toHaveLength(2);
  });

  it('does not use the file name or content type: gzip is found from the first two bytes only', async () => {
    // The same gzip bytes, split so the magic straddles two one-byte chunks.
    const result = await recordsOf(bytesOf(gzipOf(csvOf(ROWS)), 1));
    expect(result.records).toHaveLength(2);
  });

  it('keeps a multi-byte character that is split across chunks', async () => {
    const result = await recordsOf(bytesOf(csvOf([{ ...ROWS[0], title: 'ÑÑÑ€€€' }]), 1));
    expect(result.records[0].cells[1]).toBe('ÑÑÑ€€€');
  });

  it('fails 1f 8b followed by junk as invalid_gzip', async () => {
    const junk = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
    expect(await failureOf(() => recordsOf(bytesOf(junk)))).toBe('invalid_gzip');
  });

  it('fails a truncated gzip as invalid_gzip', async () => {
    const whole = gzipOf(csvOf(ROWS));
    expect(await failureOf(() => recordsOf(bytesOf(whole.subarray(0, whole.byteLength - 8))))).toBe(
      'invalid_gzip',
    );
  });

  it('fails the two magic bytes alone as invalid_gzip', async () => {
    expect(await failureOf(() => recordsOf(bytesOf(new Uint8Array([0x1f, 0x8b]))))).toBe('invalid_gzip');
  });

  it('passes a SourceError from the byte source through unchanged, plain or inside gzip', async () => {
    async function* broken(): FeedBytes {
      yield gzipOf(csvOf(ROWS)).subarray(0, 12);
      throw new SourceError('fetch_failed');
    }
    expect(await failureOf(() => recordsOf(broken()))).toBe('fetch_failed');
  });
});

describe('inflated and record caps', () => {
  it('stops a gzip bomb that is one huge CSV field at the 16 Mi-char record cap, without draining the source', async () => {
    const bomb = await gzipFillerBytes('id,title\nX,', 0x41, 96 * 1024 * 1024);
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    const { bytes, state } = lazyBytes(() => {
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < bomb.byteLength; offset += 1024) chunks.push(bomb.subarray(offset, offset + 1024));
      return chunks;
    });
    const total = Math.ceil(bomb.byteLength / 1024);
    expect(await failureOf(() => recordsOf(bytes))).toBe('too_large');
    expect(state.finished).toBe(false);
    expect(state.released).toBe(true);
    expect(state.pulled).toBeLessThan(total);
  }, 30_000);

  it('stops a plain CSV record over 16 Mi chars as too_large', async () => {
    const { bytes } = lazyBytes(() => {
      const head = [new TextEncoder().encode('id,title\nX,')];
      return [...head, ...filler(0x41, 17 * 1024 * 1024)];
    });
    expect(await failureOf(() => recordsOf(bytes))).toBe('too_large');
  });

  it('does not count a quoted multi-line field under the cap as too_large', async () => {
    const big = 'x'.repeat(1024 * 1024);
    const result = await recordsOf(bytesOf(`id,title,price,url\nA,"${big}\n${big}",1.00,https://a.example/1\n`));
    expect(result.records[0].cells[1].length).toBe(2 * big.length + 1);
  });

  it('stops one XML cell over 16 Mi chars as too_large', async () => {
    const { bytes } = lazyBytes(() => [
      new TextEncoder().encode('<r><p><id>1</id><title>'),
      ...filler(0x41, 17 * 1024 * 1024),
    ]);
    expect(await failureOf(() => recordsOf(bytes))).toBe('too_large');
  });

  it('stops one endless whitespace run inside the XML root as too_large, without draining the source', async () => {
    // No element interrupts the run, so the parser would otherwise hold it whole.
    const { bytes, state } = lazyBytes(() => [
      new TextEncoder().encode('<products>'),
      ...filler(0x20, 40 * 1024 * 1024),
    ]);
    const total = 1 + 40 * 16;
    const started = Date.now();
    expect(await failureOf(() => recordsOf(bytes))).toBe('too_large');
    expect(state.finished).toBe(false);
    expect(state.released).toBe(true);
    expect(state.pulled).toBeLessThan(total);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it('stops a gzip bomb over the 512 MiB inflated cap as too_large and leaves the source unread', async () => {
    // 600 MiB inflates past the cap of 512 MiB; the gzip itself is a few MiB. The
    // filler is an empty element then spaces, so the XML parser flushes its text
    // often (a single endless whitespace run fails earlier, see risks) and the
    // test takes about a second.
    const unit = new TextEncoder().encode(`<x/>${' '.repeat(4092)}`);
    const bomb = await gzipFillerBytes('<products>', unit, 600 * 1024 * 1024, '</products>');
    expect(bomb.byteLength).toBeLessThan(4 * 1024 * 1024);
    const { bytes, state } = lazyBytes(() => {
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < bomb.byteLength; offset += 1024) chunks.push(bomb.subarray(offset, offset + 1024));
      return chunks;
    });
    const total = Math.ceil(bomb.byteLength / 1024);
    const started = Date.now();
    expect(await failureOf(() => recordsOf(bytes))).toBe('too_large');
    expect(state.finished).toBe(false);
    expect(state.released).toBe(true);
    expect(state.pulled).toBeLessThan(total);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 60_000);

  it('decodeFeed alone enforces the inflated cap, before any format is known', async () => {
    const bomb = await gzipFillerBytes('', 0x20, 600 * 1024 * 1024);
    expect(await failureOf(() => drain(decodeFeed(bytesOf(bomb, 4096))))).toBe('too_large');
  }, 60_000);
});

describe('close()', () => {
  it('releases the byte source when the CSV header is unreadable and nothing is iterated', async () => {
    const { bytes, state } = lazyBytes(() => [new TextEncoder().encode('title,price\n'), new Uint8Array(10)]);
    const opened = await openRecords(bytes);
    expect(opened.header).toEqual(['title', 'price']);
    await opened.close();
    expect(state.released).toBe(true);
  });

  it('releases the source when opening throws (bad gzip), before the error reaches the caller', async () => {
    const junk = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    const { bytes, state } = lazyBytes(() => [junk, ...Array.from({ length: 5000 }, () => new Uint8Array(1024))]);
    expect(await failureOf(() => openRecords(bytes))).toBe('invalid_gzip');
    await vi.waitFor(() => expect(state.released).toBe(true));
    expect(state.pulled).toBeLessThan(5000);
  });

  it('can be called twice and after the records were read', async () => {
    const opened = await openRecords(bytesOf(csvOf(ROWS)));
    await drain(opened.records);
    await opened.close();
    await opened.close();
  });
});

describe('XML record rule (D4)', () => {
  it('reads the basic fixture into canonical cells in CANONICAL_COLUMNS order', async () => {
    const result = await recordsOf(bytesOf(readFeedFixture('xml-basic.xml')));
    const cells = result.records[0].cells;
    const byName = Object.fromEntries(CANONICAL_COLUMNS.map((name, i) => [name, cells[i]]));
    expect(byName).toMatchObject({
      id: 'A-1',
      title: 'Fixture Alpha Filtro',
      price: '10.00',
      url: 'https://shop-a.example/p/A-1',
      brand: 'MarcaUno',
      ean: '2000000000046',
      category: '',
    });
    expect(cells).toHaveLength(CANONICAL_COLUMNS.length);
    expect(result.records.map((r) => r.record)).toEqual([2, 3]);
  });

  it('finds items under rss/channel, strips g: prefixes, keeps CDATA, first duplicate wins, ignores unknown children', async () => {
    const result = await recordsOf(bytesOf(readFeedFixture('xml-rss-google.xml')));
    expect(result.records).toHaveLength(2);
    const first = Object.fromEntries(CANONICAL_COLUMNS.map((name, i) => [name, result.records[0].cells[i]]));
    expect(first).toMatchObject({
      id: 'G-1',
      title: 'Google Filtro de aire',
      price: '12.34',
      url: 'https://shop-g.example/p/G-1',
      brand: 'Marca & Co',
    });
    const second = Object.fromEntries(CANONICAL_COLUMNS.map((name, i) => [name, result.records[1].cells[i]]));
    expect(second.title).toBe('Google Taladro & broca');
  });

  it('matches names case-insensitively and trims text', async () => {
    const xml = '<r><P><ID> 7 </ID><Title>  T </Title><PRICE>1.00</PRICE><URL>https://a.example/7</URL></P></r>';
    const result = await recordsOf(bytesOf(xml));
    expect(result.records[0].cells.slice(0, 4)).toEqual(['7', 'T', '1.00', 'https://a.example/7']);
  });

  it('resolves the five predefined and numeric references', async () => {
    const xml = '<r><p><id>1</id><title>&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos; &#65;&#x42;</title></p></r>';
    const result = await recordsOf(bytesOf(xml));
    expect(result.records[0].cells[1]).toBe('<a> & "b" \'c\' AB');
  });

  it('treats an element without an id child as not a record, and uses the first element that has one', async () => {
    const xml =
      '<r><p><title>no id</title></p><p><id>1</id><title>one</title></p><p><id>2</id><title>two</title></p></r>';
    const result = await recordsOf(bytesOf(xml));
    expect(result.records.map((r) => r.cells[0])).toEqual(['1', '2']);
    // Record numbers count record elements, so the id-less sibling is not one.
    expect(result.records.map((r) => r.record)).toEqual([2, 3]);
  });

  it('yields absent cells as empty strings', async () => {
    const result = await recordsOf(bytesOf('<r><p><id>1</id></p></r>'));
    expect(result.records[0].cells.slice(1)).toEqual(Array(CANONICAL_COLUMNS.length - 1).fill(''));
  });

  describe('the fitment element (S5.6, AC 2, 3, 6)', () => {
    const fitmentOf = async (xml: string): Promise<string[]> => {
      const result = await recordsOf(bytesOf(xml));
      const at = CANONICAL_COLUMNS.indexOf('fitment');
      return result.records.map((r) => r.cells[at]);
    };

    it('puts fitment last in the cell order, after every older column', () => {
      expect(CANONICAL_COLUMNS.at(-1)).toBe('fitment');
    });

    it('reads the text of the element, trimmed, with the | kept for the row validator', async () => {
      expect(await fitmentOf('<r><p><id>1</id><fitment> a-1|b-2 </fitment></p></r>')).toEqual(['a-1|b-2']);
    });

    it('finds it with a prefix and in any letter case', async () => {
      const xml =
        '<r><p><id>1</id><g:fitment>a-1</g:fitment></p><p><id>2</id><FITMENT>b-2</FITMENT></p></r>';
      expect(await fitmentOf(xml)).toEqual(['a-1', 'b-2']);
    });

    it('lets the first of two fitment children win', async () => {
      expect(await fitmentOf('<r><p><id>1</id><fitment>a-1</fitment><fitment>b-2</fitment></p></r>')).toEqual([
        'a-1',
      ]);
    });

    it('reads an empty element and an absent element alike, as an empty cell', async () => {
      const xml = '<r><p><id>1</id><fitment></fitment></p><p><id>2</id><fitment/></p><p><id>3</id></p></r>';
      expect(await fitmentOf(xml)).toEqual(['', '', '']);
    });

    it('gives the same list as the CSV column for the same text (AC 3)', async () => {
      const row = { id: 'F-1', title: 'T', price: '1.00', url: 'https://a.example/1', fitment: ' a-1 |b-2|a-1' };
      const fromXml = await recordsOf(bytesOf(xmlOf([row])));
      const fromCsv = await recordsOf(bytesOf(csvOf([row])));
      const csvIndex = (fromCsv.header ?? []).indexOf('fitment');
      expect(csvIndex).toBeGreaterThan(-1);
      const xmlCell = fromXml.records[0].cells[CANONICAL_COLUMNS.indexOf('fitment')];
      const columnsOf = (header: string[]) => readHeader(header);
      const parse = (cells: string[], header: string[]) => {
        const columns = columnsOf(header);
        if (!columns) throw new Error('header');
        const result = validateRow(cells, columns, 2);
        if (!result.ok) throw new Error(result.reject.code);
        return result.row.fitment;
      };
      expect(xmlCell.trim()).toBe(fromCsv.records[0].cells[csvIndex].trim());
      expect(parse(fromXml.records[0].cells, fromXml.header ?? [])).toEqual(
        parse(fromCsv.records[0].cells, fromCsv.header ?? []),
      );
      expect(parse(fromXml.records[0].cells, fromXml.header ?? [])).toEqual(['a-1', 'b-2']);
    });
  });

  it('fails a DOCTYPE as invalid_xml, so no entity can be defined', async () => {
    expect(await failureOf(() => recordsOf(bytesOf(readFeedFixture('xml-doctype.xml'))))).toBe('invalid_xml');
  });

  it('fails an unknown entity as invalid_xml', async () => {
    const xml = '<r><p><id>1</id><title>&nope;</title></p></r>';
    expect(await failureOf(() => recordsOf(bytesOf(xml)))).toBe('invalid_xml');
  });

  it('fails a mismatched close tag as invalid_xml', async () => {
    expect(await failureOf(() => recordsOf(bytesOf(readFeedFixture('xml-malformed.xml'))))).toBe('invalid_xml');
  });

  it('fails a document cut short as invalid_xml', async () => {
    const xml = readFeedFixture('xml-basic.xml');
    expect(await failureOf(() => recordsOf(bytesOf(xml.slice(0, xml.length - 20))))).toBe('invalid_xml');
  });

  it('fails a document with no record element as invalid_xml', async () => {
    expect(await failureOf(() => recordsOf(bytesOf(readFeedFixture('xml-no-records.xml'))))).toBe(
      'invalid_xml',
    );
  });

  it('gives the same records whatever the chunk size', async () => {
    const xml = readFeedFixture('xml-rss-google.xml');
    const whole = await recordsOf(bytesOf(xml));
    for (const size of [1, 3, 7, 64]) {
      expect((await recordsOf(bytesOf(xml, size))).records).toEqual(whole.records);
    }
  });

  it('xmlRecords yields completed records before the rest of the text has arrived', async () => {
    let pulled = 0;
    async function* chunks(): AsyncGenerator<string> {
      pulled += 1;
      yield '<r><p><id>1</id><title>one</title></p><p><id>2</id>';
      pulled += 1;
      yield '<title>two</title></p></r>';
    }
    const reader = xmlRecords(chunks());
    const first = await reader.next();
    expect(first.value?.[0]).toBe('1');
    expect(pulled).toBe(1);
    expect((await reader.next()).value?.[0]).toBe('2');
    expect((await reader.next()).done).toBe(true);
  });
});
