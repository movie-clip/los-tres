import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getDb } from '@/db/client';
import { feeds } from '@/db/schema';
import { importFeeds } from '@/server/importer';
import { readFeedSource } from '@/server/importer/source';

import { insertShop } from './catalogue';
import { assertTestDatabase } from './db';

// Support for the S3.7 catalogue-file tests. Every test reads a TEMP folder passed to the
// importer as `catalogueDir`, never the repo's catalogue-files/ (which holds the owner's real
// files). The shops, products and files in these tests are invented.

/** One catalogue row; every key is a canonical column the importer reads. */
export type CatalogueRow = Partial<
  Record<'id' | 'title' | 'price' | 'url' | 'brand' | 'part_number' | 'ean' | 'currency' | 'category', string>
>;

const COLUMNS = ['id', 'title', 'price', 'url', 'brand', 'part_number', 'ean', 'currency', 'category'] as const;

/**
 * CSV text with the nine canonical columns, header first. Unlike `csvOf` it writes the
 * `category` and `part_number` columns. A value holding a comma or a quote is quoted, so a
 * decimal-comma price such as `12,99` stays one cell.
 */
export function catalogueCsv(rows: CatalogueRow[]): string {
  const cell = (value: string) => (/[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = rows.map((row) => COLUMNS.map((column) => cell(row[column] ?? '')).join(','));
  return `${COLUMNS.join(',')}\n${lines.join('\n')}\n`;
}

/** A fresh temp folder, and the call that removes it. */
export async function tempCatalogueFolder(): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'los-tres-catalogue-'));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/** A catalogue_file feed (no network), approved and not demo unless the test says otherwise. */
export async function insertFileFeed(
  shopId: number,
  name: string,
  o: { isApproved?: boolean; isDemo?: boolean } = {},
): Promise<number> {
  await assertTestDatabase();
  const [row] = await getDb()
    .insert(feeds)
    .values({
      shopId,
      networkId: null,
      sourceType: 'catalogue_file',
      url: name,
      isApproved: o.isApproved ?? true,
      isDemo: o.isDemo ?? false,
    })
    .returning({ id: feeds.id });
  return row.id;
}

/** A shop and a file feed together. The shop is approved by default, like `insertShop`. */
export async function aFileFeed(
  name: string,
  o: { shopName?: string; shopApproved?: boolean; feedApproved?: boolean } = {},
): Promise<{ shopId: number; shopName: string; feedId: number }> {
  const shop = await insertShop({ name: o.shopName, isApproved: o.shopApproved });
  const feedId = await insertFileFeed(shop.id, name, { isApproved: o.feedApproved });
  return { shopId: shop.id, shopName: shop.name, feedId };
}

/** `importFeeds` with the real source reader pointed at the temp folder. */
export function importFromFolder(dir: string, o: { feedId?: number } = {}) {
  return importFeeds(getDb(), {
    ...(o.feedId === undefined ? {} : { feedId: o.feedId }),
    deps: { readSource: (feed) => readFeedSource(feed, { catalogueDir: dir }) },
  });
}
