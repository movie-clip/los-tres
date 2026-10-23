import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';
import { SourceError } from '@/server/importer/source';
import type { FeedBytes, FeedFailure } from '@/server/importer/types';

import { allOffers, allProducts, insertFeed, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import {
  bytesOf,
  csvOf,
  gzipOf,
  lazyBytes,
  readFeedFixture,
  textDeps,
  xmlOf,
  type FeedRow,
} from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';

// XML and gzip feeds through the whole importer (issue #29): the same data in
// four encodings reports the same, a failure part-way writes nothing, and the
// source is released and read lazily. No network: every source is a local one.

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

async function oneFeed(): Promise<number> {
  const shop = await insertShop();
  return insertFeed(shop.id, { url: 'served-by-the-test' });
}

async function importServed(served: string | Uint8Array | Error) {
  const feedId = await oneFeed();
  const report = await importFeeds(getDb(), { deps: textDeps({ [feedId]: served }) });
  return { feedId, feed: report.feeds[0], report };
}

/** Rows that cover every outcome, in an order that makes record numbers matter. */
const MIXED: FeedRow[] = [
  { id: 'P-1', title: 'Filtro uno', price: '19.99', url: 'https://shop-p.example/1', currency: 'EUR' },
  { id: '', title: 'Sin id', price: '5.00', url: 'https://shop-p.example/2' },
  { id: 'P-3', title: 'Precio malo', price: '1.005', url: 'https://shop-p.example/3' },
  { id: 'P-4', title: 'Moneda distinta', price: '5.00', url: 'https://shop-p.example/4', currency: 'USD' },
  { id: 'P-5', title: 'Taladro', price: '0.29', url: 'https://shop-p.example/5', ean: '2000000000046' },
  { id: 'P-1', title: 'Id repetido', price: '6.00', url: 'https://shop-p.example/6' },
  { id: 'P-7', title: 'Url mala', price: '5.00', url: 'ftp://shop-p.example/7' },
];

describe('XML feeds', () => {
  it('imports the basic XML fixture the way its CSV twin imports', async () => {
    const xml = await importServed(readFeedFixture('xml-basic.xml'));
    await resetDatabase();
    const csv = await importServed(readFeedFixture('ean-first.csv'));
    const strip = (feed: (typeof xml)['feed']) => ({ ...feed, feedId: 0, shopName: '' });
    expect(strip(xml.feed)).toEqual(strip(csv.feed));
    expect(xml.feed).toMatchObject({ outcome: 'imported', productsCreated: 2, offersCreated: 2 });
  });

  it('imports a Google-style rss feed, with prefixes stripped and prices as integer cents', async () => {
    const { feed } = await importServed(readFeedFixture('xml-rss-google.xml'));
    expect(feed).toMatchObject({ outcome: 'imported', offersCreated: 2, rejected: [] });
    const offers = await allOffers();
    expect(offers.map((offer) => offer.priceCents).sort((a, b) => a - b)).toEqual([1234, 9999]);
    const products = await allProducts();
    expect(products.map((product) => product.title).sort()).toEqual([
      'Google Filtro de aire',
      'Google Taladro & broca',
    ]);
  });

  it.each([
    ['a DOCTYPE', 'xml-doctype.xml', 'invalid_xml'],
    ['malformed XML', 'xml-malformed.xml', 'invalid_xml'],
    ['no record element', 'xml-no-records.xml', 'invalid_xml'],
  ] as const)('fails %s as %s and writes nothing', async (_label, fixture, code) => {
    const { feed, report } = await importServed(readFeedFixture(fixture));
    expect(feed).toMatchObject({ outcome: 'failed', failure: code });
    expect(importExitCode(report)).toBe(1);
    expect(formatImportReport(report)).toContain(`failed ${code}`);
    expect(await allProducts()).toEqual([]);
    expect(await allOffers()).toEqual([]);
  });
});

describe('the same data in four encodings (parity)', () => {
  it('reports identical counts and rejects, record numbers included', async () => {
    const encodings: [string, string | Uint8Array][] = [
      ['csv', csvOf(MIXED)],
      ['xml', xmlOf(MIXED)],
      ['csv.gz', gzipOf(csvOf(MIXED))],
      ['xml.gz', gzipOf(xmlOf(MIXED))],
    ];
    const reports = [];
    const stored = [];
    for (const [, served] of encodings) {
      await resetDatabase();
      const { feed } = await importServed(served);
      reports.push({ ...feed, feedId: 0, shopName: '' });
      stored.push({
        products: (await allProducts()).map((p) => [p.title, p.ean]),
        offers: (await allOffers()).map((o) => [o.externalId, o.priceCents, o.url]),
      });
    }
    expect(reports[0]).toMatchObject({ outcome: 'imported', rows: 7, offersCreated: 2 });
    // Record 1 is the header, so the first data row is record 2 in every format.
    expect(reports[0].rejected.map((r) => [r.record, r.code])).toEqual([
      [3, 'missing_id'],
      [4, 'invalid_price'],
      [5, 'invalid_currency'],
      [7, 'duplicate_id'],
      [8, 'invalid_url'],
    ]);
    for (const other of reports.slice(1)) expect(other).toEqual(reports[0]);
    for (const other of stored.slice(1)) expect(other).toEqual(stored[0]);
    expect(stored[0].offers).toContainEqual(['P-1', 1999, 'https://shop-p.example/1']);
  });

  it('a second import of the gzip XML twin changes no counts but updates', async () => {
    const feedId = await oneFeed();
    const deps = textDeps({ [feedId]: gzipOf(xmlOf(MIXED)) });
    await importFeeds(getDb(), { deps });
    const again = (await importFeeds(getDb(), { deps })).feeds[0];
    expect(again).toMatchObject({ outcome: 'imported', offersCreated: 0, offersUpdated: 2, productsCreated: 0 });
  });
});

describe('failures part-way write nothing (D8, one transaction per feed)', () => {
  const good = (n: number): FeedRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `G-${i}`,
      title: `Bueno ${i}`,
      price: '1.00',
      url: `https://shop-g.example/${i}`,
    }));

  async function expectNothingWritten(): Promise<void> {
    expect(await allProducts()).toEqual([]);
    expect(await allOffers()).toEqual([]);
  }

  it('rolls back 50 good records when the XML breaks after them', async () => {
    const broken = `${xmlOf(good(50)).replace('</products>', '')}<product><id>X</id><title>cut`;
    const { feed } = await importServed(broken);
    expect(feed).toMatchObject({ outcome: 'failed', failure: 'invalid_xml' });
    await expectNothingWritten();
  });

  it('rolls back when a mismatched close tag follows good records', async () => {
    const broken = xmlOf(good(50)).replace('</products>', '<product><id>Y</id></oops></products>');
    const { feed } = await importServed(broken);
    expect(feed).toMatchObject({ outcome: 'failed', failure: 'invalid_xml' });
    await expectNothingWritten();
  });

  it('rolls back when a gzip is cut off after good records', async () => {
    const whole = gzipOf(csvOf(good(400)));
    const { feed } = await importServed(whole.subarray(0, whole.byteLength - 30));
    expect(feed).toMatchObject({ outcome: 'failed', failure: 'invalid_gzip' });
    await expectNothingWritten();
  });

  it('rolls back when the byte source throws a too_large SourceError after good records', async () => {
    const feedId = await oneFeed();
    const text = csvOf(good(50));
    const report = await importFeeds(getDb(), {
      deps: {
        readSource: async () => {
          async function* capped(): FeedBytes {
            yield* bytesOf(text);
            throw new SourceError('too_large');
          }
          return capped();
        },
      },
    });
    expect(report.feeds[0]).toMatchObject({ feedId, outcome: 'failed', failure: 'too_large' });
    await expectNothingWritten();
  });

  it('reports a redirect_refused from the source and still imports the next feed', async () => {
    const first = await oneFeed();
    const second = await oneFeed();
    const report = await importFeeds(getDb(), {
      deps: {
        readSource: async (feed) => {
          if (feed.id === first) throw new SourceError('redirect_refused');
          return bytesOf(csvOf(good(3)));
        },
      },
    });
    const codes: [number, string, FeedFailure | undefined][] = report.feeds.map((f) => [
      f.feedId,
      f.outcome,
      f.failure,
    ]);
    expect(codes).toEqual([
      [first, 'failed', 'redirect_refused'],
      [second, 'imported', undefined],
    ]);
    expect(formatImportReport(report)).toContain('failed redirect_refused');
    expect((await allOffers()).every((offer) => offer.feedId === second)).toBe(true);
  });

  it('leaves the previous import of the feed intact when the next one fails mid-stream', async () => {
    const feedId = await oneFeed();
    await importFeeds(getDb(), { deps: textDeps({ [feedId]: csvOf(good(5)) }) });
    const before = await allOffers();
    const broken = `${xmlOf(good(5)).replace('</products>', '')}<product><id>`;
    const report = await importFeeds(getDb(), { deps: textDeps({ [feedId]: broken }) });
    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'invalid_xml' });
    expect(await allOffers()).toEqual(before);
  });
});

describe('the source is released', () => {
  it('cancels the download of a feed whose CSV header is unusable, and writes nothing', async () => {
    const feedId = await oneFeed();
    const header = new TextEncoder().encode('title,brand\n');
    const { bytes, state } = lazyBytes(() => [header, ...Array.from({ length: 2000 }, () => new Uint8Array(512))]);
    const report = await importFeeds(getDb(), { deps: { readSource: async () => bytes } });
    expect(report.feeds[0]).toMatchObject({ feedId, outcome: 'failed', failure: 'invalid_header', rows: 0 });
    expect(state.released).toBe(true);
    expect(state.pulled).toBeLessThan(2001);
  });

  it('does not read a feed that is not approved', async () => {
    const shop = await insertShop();
    await insertFeed(shop.id, { url: 'x.xml', isApproved: false });
    const readSource = vi.fn(async () => bytesOf(readFeedFixture('xml-basic.xml')));
    const report = await importFeeds(getDb(), { deps: { readSource } });
    expect(report.feeds).toEqual([]);
    expect(readSource).not.toHaveBeenCalled();
    expect(await allOffers()).toEqual([]);
  });
});

describe('a large feed streams', () => {
  // The importer needs about 2.7 ms a row on the Compose database, so 10,000 rows
  // took 27 s. 3,000 rows in many chunks proves the same streaming in under 10 s.
  const ROWS = 3_000;

  it('imports 3,000 rows and writes products before the byte source is exhausted', async () => {
    const feedId = await oneFeed();
    const lines = (function* () {
      const encoder = new TextEncoder();
      yield encoder.encode('id,title,price,url\n');
      let block = '';
      for (let i = 0; i < ROWS; i += 1) {
        block += `L-${i},Producto grande ${i},${(i % 900) + 1}.${String(i % 100).padStart(2, '0')},https://shop-l.example/${i}\n`;
        if (block.length > 4 * 1024) {
          yield encoder.encode(block);
          block = '';
        }
      }
      if (block !== '') yield encoder.encode(block);
    })();

    const chunks = [...lines];
    const sequenceAtPull: number[] = [];
    async function* source(): FeedBytes {
      for (const [index, chunk] of chunks.entries()) {
        // Sequences advance outside the feed's transaction, so another
        // connection sees how many products the importer has created so far.
        const seen = await getDb().execute<{ last: string | null }>(
          sql`select case when is_called then last_value else 0 end as last from products_id_seq`,
        );
        sequenceAtPull[index] = Number(seen.rows[0]?.last ?? 0);
        yield chunk;
      }
    }

    const started = Date.now();
    const report = await importFeeds(getDb(), { deps: { readSource: async () => source() } });
    expect(report.feeds[0]).toMatchObject({
      feedId,
      outcome: 'imported',
      rows: ROWS,
      productsCreated: ROWS,
      offersCreated: ROWS,
      rejected: [],
    });
    expect((await allOffers()).length).toBe(ROWS);

    // Midway through the source, products already exist: rows are written as
    // chunks arrive, not after the whole file is read.
    const middle = Math.floor(chunks.length / 2);
    expect(chunks.length).toBeGreaterThan(10);
    expect(sequenceAtPull[0]).toBe(0);
    expect(sequenceAtPull[middle]).toBeGreaterThan(0);
    expect(sequenceAtPull[middle]).toBeLessThan(ROWS);
    expect(Date.now() - started).toBeLessThan(25_000);
  }, 30_000);
});
