import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEan } from '@/server/matching';
import { parseCsv } from '@/server/importer/csv';
import { readHeader, validateRow, type ValidRow } from '@/server/importer/validate';
import { demoCategoryMappings, demoShops } from '@/server/seed/demo-data';

import { DEMO_CATEGORY_COUNTS, DEMO_COUNTS, DEMO_FEED_ROWS } from '../fixtures/demo';

// The shipped demo feeds (demo/feeds/*.csv) are data, not code: this reads them
// with the importer's own header and row validators and pins the invariants the
// fixtures in tests/fixtures/demo.ts and the e2e rely on. No database, no network.

const FEED_DIR = path.resolve(import.meta.dirname, '../../demo/feeds');
const HEADER = 'id,title,brand,part_number,ean,price,currency,url,description,category';
const PAGE_SIZE = 24;

type DemoRow = ValidRow & { feedFile: string; leaf: string | null };

function loadFeed(feedFile: string): { rows: DemoRow[]; rejects: unknown[]; header: string } {
  const text = readFileSync(path.join(FEED_DIR, feedFile), 'utf8');
  const [header, ...records] = parseCsv(text).filter((cells) => cells.some((cell) => cell.trim() !== ''));
  const columns = readHeader(header);
  if (columns === null) throw new Error(`${feedFile}: header misses a required column`);
  const rows: DemoRow[] = [];
  const rejects: unknown[] = [];
  records.forEach((cells, index) => {
    const result = validateRow(cells, columns, index + 2);
    if (!result.ok) {
      rejects.push(result.reject);
      return;
    }
    const mapping = demoCategoryMappings.find(
      (m) => m.feedFile === feedFile && m.feedCategory === result.row.feedCategory,
    );
    rows.push({ ...result.row, feedFile, leaf: mapping?.categorySlug ?? null });
  });
  return { rows, rejects, header: header.join(',') };
}

const feeds = demoShops.map((shop) => ({ shop, ...loadFeed(shop.feedFile) }));
const allRows = feeds.flatMap((feed) => feed.rows);

/** A product as the importer sees it: rows sharing an EAN are one product, a row without EAN is its own. */
function productKey(row: DemoRow): string {
  return row.eanNormalised ?? `${row.feedFile}:${row.externalId}`;
}

function groupProducts(): Map<string, DemoRow[]> {
  const groups = new Map<string, DemoRow[]>();
  for (const row of allRows) groups.set(productKey(row), [...(groups.get(productKey(row)) ?? []), row]);
  return groups;
}

describe('shipped demo feeds (demo/feeds/*.csv)', () => {
  it.each(feeds.map((feed) => [feed.shop.feedFile, feed] as const))(
    '%s has the canonical header and no rejected row',
    (_file, feed) => {
      expect(feed.header).toBe(HEADER);
      expect(feed.rejects).toEqual([]);
    },
  );

  it('has one feed file per demo shop, with the row counts the fixtures expect', () => {
    expect(feeds.map((feed) => feed.rows.length)).toEqual([
      DEMO_FEED_ROWS.uno.rows,
      DEMO_FEED_ROWS.dos.rows,
      DEMO_FEED_ROWS.tres.rows,
      DEMO_FEED_ROWS.cuatro.rows,
    ]);
    expect(allRows).toHaveLength(DEMO_COUNTS.offers);
    expect(new Set(feeds.map((feed) => feed.shop.feedFile)).size).toBe(DEMO_COUNTS.feeds);
  });

  it('uses each external id once per feed and never a retired filler id', () => {
    for (const feed of feeds) {
      const ids = feed.rows.map((row) => row.externalId);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(allRows.some((row) => /^UNO-1\d\d$/.test(row.externalId))).toBe(false);
  });

  it('starts every title with DEMO, so every slug starts demo-', () => {
    for (const row of allRows) expect(row.title.startsWith('DEMO ')).toBe(true);
  });

  it('gives every EAN a valid check digit, in the reserved 200 internal-use prefix', () => {
    for (const row of allRows.filter((r) => r.ean !== null)) {
      expect(parseEan(row.ean ?? '').kind).toBe('valid');
      expect(row.eanNormalised).toMatch(/^200\d{10}$/);
    }
  });

  it('keeps every shop link on its own reserved .example host', () => {
    for (const feed of feeds) {
      for (const row of feed.rows) {
        expect(new URL(row.url).hostname).toBe(`${feed.shop.slug}.example`);
      }
    }
  });

  it('writes every price as a decimal string with exactly two decimals (no float, no whole euro)', () => {
    for (const feed of feeds) {
      const text = readFileSync(path.join(FEED_DIR, feed.shop.feedFile), 'utf8');
      const [header, ...records] = parseCsv(text).filter((cells) => cells.some((cell) => cell.trim() !== ''));
      const priceAt = header.indexOf('price');
      for (const cells of records) expect(cells[priceAt].trim()).toMatch(/^\d+\.\d\d$/);
    }
  });

  it('shares brand, title and category leaf across every row of one EAN, except the grandfathered OC 1234 pair', () => {
    for (const [key, rows] of groupProducts()) {
      if (rows.length < 2) continue;
      const leaves = new Set(rows.map((row) => row.leaf));
      expect(leaves.size, `leaf of ${key}`).toBe(1);
      expect(new Set(rows.map((row) => row.brand)).size, `brand of ${key}`).toBe(1);
      if (rows.some((row) => row.externalId === 'DOS-100')) continue;
      expect(new Set(rows.map((row) => row.title)).size, `title of ${key}`).toBe(1);
    }
  });

  it('never prices one product twice at the same amount', () => {
    for (const [key, rows] of groupProducts()) {
      const prices = rows.map((row) => row.priceCents);
      expect(new Set(prices).size, `prices of ${key}`).toBe(prices.length);
    }
  });

  it('gives each product a unique title', () => {
    const titles = [...groupProducts().values()].map((rows) => rows[0].title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('maps no feed category to filtros-de-combustible: that category stays empty', () => {
    expect(demoCategoryMappings.some((m) => (m.categorySlug as string) === 'filtros-de-combustible')).toBe(false);
    expect(allRows.some((row) => (row.leaf as string | null) === 'filtros-de-combustible')).toBe(false);
    expect(DEMO_CATEGORY_COUNTS['filtros-de-combustible']).toBe(0);
  });

  it('has a mapping for every demo feed category it declares, except the deliberately unmapped products', () => {
    const unmapped = allRows.filter((row) => row.leaf === null);
    expect(unmapped.map((row) => row.externalId).sort()).toEqual(['DOS-101', 'DOS-102', 'DOS-103', 'UNO-002']);
  });

  it('keeps the catalogue to the fixture counts: products, public products, per leaf', () => {
    const groups = groupProducts();
    const mapped = [...groups.values()].filter((rows) => rows[0].leaf !== null);
    expect(groups.size).toBe(DEMO_COUNTS.products);
    expect(mapped).toHaveLength(DEMO_COUNTS.publicProducts);
    const perLeaf = new Map<string, number>();
    for (const rows of mapped) perLeaf.set(rows[0].leaf ?? '', (perLeaf.get(rows[0].leaf ?? '') ?? 0) + 1);
    for (const [leaf, count] of perLeaf) {
      expect(count, leaf).toBe(DEMO_CATEGORY_COUNTS[leaf as keyof typeof DEMO_CATEGORY_COUNTS]);
      expect(count, `${leaf} stays on one page`).toBeLessThanOrEqual(PAGE_SIZE);
    }
  });
});
