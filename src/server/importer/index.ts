import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import type { Database, Executor } from '../../db/client';
import { feeds, offers, products, shops } from '../../db/schema';
import { matchProduct, normalizeBrand, normalizePartNumber } from '../matching';
import { slugify, uniqueSlug } from '../slug';
import { parseCsv } from './csv';
import { formatImportReport, importExitCode } from './report';
import { readFeedSource, SourceError } from './source';
import {
  FeedNotRegisteredError,
  type FeedFailure,
  type FeedImportReport,
  type FeedSourceRef,
  type ImportDeps,
  type ImportReport,
  type RejectedRow,
} from './types';
import { readHeader, validateRow, type ColumnIndex, type ValidRow } from './validate';

// The only writer of `products` and `offers` from outside data (guardrail 1).
// It reads feeds registered as rows, never a URL or a path (guardrail 2), and
// never writes an approval, hidden or review column on an existing row (TD-21).

export { FeedNotRegisteredError, formatImportReport, importExitCode };
export type { FeedImportReport, ImportDeps, ImportReport, RejectedRow };

type FeedRow = {
  id: number;
  url: string;
  isDemo: boolean;
  isApproved: boolean;
  shopName: string;
};

/**
 * Imports the approved feeds in id order, or the one feed `options.feedId`
 * (throws `FeedNotRegisteredError` when no such row exists; a row that exists
 * but is not approved is reported `skipped` and its source is not read).
 * One transaction per feed; a failing feed never stops the others.
 */
export async function importFeeds(
  db: Database,
  options: { feedId?: number; deps?: ImportDeps } = {},
): Promise<ImportReport> {
  const deps = options.deps ?? {};
  const readSource = deps.readSource ?? readFeedSource;
  const startedAt = (deps.now ?? (() => new Date()))();

  const registered = await loadFeeds(db, options.feedId);
  if (options.feedId !== undefined && registered.length === 0) {
    throw new FeedNotRegisteredError();
  }

  const reports: FeedImportReport[] = [];
  for (const feed of registered) {
    reports.push(await importOneFeed(db, feed, readSource, startedAt));
  }
  return { startedAt, feeds: reports };
}

async function loadFeeds(db: Executor, feedId: number | undefined): Promise<FeedRow[]> {
  const rows = db
    .select({
      id: feeds.id,
      url: feeds.url,
      isDemo: feeds.isDemo,
      isApproved: feeds.isApproved,
      shopName: shops.name,
    })
    .from(feeds)
    .innerJoin(shops, eq(feeds.shopId, shops.id));
  return await (feedId === undefined
    ? rows.where(eq(feeds.isApproved, true)).orderBy(asc(feeds.id))
    : rows.where(eq(feeds.id, feedId)).orderBy(asc(feeds.id)));
}

function emptyReport(feed: FeedRow): FeedImportReport {
  return {
    feedId: feed.id,
    shopName: feed.shopName,
    outcome: 'imported',
    rows: 0,
    productsCreated: 0,
    offersCreated: 0,
    offersUpdated: 0,
    rejected: [],
  };
}

function failed(feed: FeedRow, failure: FeedFailure): FeedImportReport {
  return { ...emptyReport(feed), outcome: 'failed', failure };
}

async function importOneFeed(
  db: Database,
  feed: FeedRow,
  readSource: (feed: FeedSourceRef) => Promise<string>,
  startedAt: Date,
): Promise<FeedImportReport> {
  if (!feed.isApproved) {
    return { ...emptyReport(feed), outcome: 'skipped', skipReason: 'not_approved' };
  }

  let text: string;
  try {
    text = await readSource({ id: feed.id, url: feed.url, isDemo: feed.isDemo });
  } catch (error) {
    // The error is dropped: it may name the URL, which can hold an API key.
    return failed(feed, error instanceof SourceError ? error.code : 'fetch_failed');
  }

  const [header, ...records] = parseCsv(text);
  const columns = header ? readHeader(header) : null;
  if (!columns) return failed(feed, 'invalid_header');

  try {
    return await db.transaction((tx) => importRecords(tx, feed, columns, records, startedAt));
  } catch {
    // Rolled back. The error is dropped: a driver message can carry row values.
    return failed(feed, 'database_error');
  }
}

async function importRecords(
  tx: Executor,
  feed: FeedRow,
  columns: ColumnIndex,
  records: string[][],
  startedAt: Date,
): Promise<FeedImportReport> {
  const report = emptyReport(feed);
  const seenIds = new Set<string>();

  for (const [position, cells] of records.entries()) {
    const record = position + 2; // the header is record 1
    report.rows += 1;

    const result = validateRow(cells, columns, record);
    if (!result.ok) {
      report.rejected.push(result.reject);
      continue;
    }
    const row = result.row;
    if (seenIds.has(row.externalId)) {
      report.rejected.push({ record, code: 'duplicate_id', field: 'id' });
      continue;
    }
    seenIds.add(row.externalId);

    const known = await findOffer(tx, feed.id, row.externalId);
    if (known) {
      await writeOffer(tx, feed.id, known.productId, row, startedAt);
      report.offersUpdated += 1;
      continue;
    }

    const brandNormalised = normalizeBrand(row.brand);
    const match = await matchProduct(tx, { eanNormalised: row.eanNormalised, brandNormalised });
    if (match.kind === 'reject') {
      report.rejected.push({ record, code: match.code, field: 'ean' });
      continue;
    }

    let productId: number;
    if (match.kind === 'attach') {
      productId = match.productId;
    } else {
      productId = await createProduct(tx, row, brandNormalised);
      report.productsCreated += 1;
    }
    await writeOffer(tx, feed.id, productId, row, startedAt);
    report.offersCreated += 1;
  }
  return report;
}

async function findOffer(tx: Executor, feedId: number, externalId: string) {
  const [found] = await tx
    .select({ productId: offers.productId })
    .from(offers)
    .where(and(eq(offers.feedId, feedId), eq(offers.externalId, externalId)))
    .limit(1);
  return found;
}

/** Product text is written here only, once, and never updated (TD-23). */
async function createProduct(
  tx: Executor,
  row: ValidRow,
  brandNormalised: string | null,
): Promise<number> {
  const slug = await uniqueSlug(slugify(row.title), async (candidate) => {
    const taken = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, candidate))
      .limit(1);
    return taken.length > 0;
  });
  const [created] = await tx
    .insert(products)
    .values({
      slug,
      title: row.title,
      brand: row.brand,
      brandNormalised,
      partNumber: row.partNumber,
      partNumberNormalised: normalizePartNumber(row.partNumber),
      ean: row.ean,
      eanNormalised: row.eanNormalised,
      description: row.description,
    })
    .returning({ id: products.id });
  return created.id;
}

/**
 * Upserts on (feed_id, external_id). The update lists exactly price, url and
 * date: never product_id, is_hidden or in_review (TD-21, TD-24).
 */
async function writeOffer(
  tx: Executor,
  feedId: number,
  productId: number,
  row: ValidRow,
  startedAt: Date,
): Promise<void> {
  await tx
    .insert(offers)
    .values({
      productId,
      feedId,
      externalId: row.externalId,
      priceCents: row.priceCents,
      url: row.url,
      priceUpdatedAt: startedAt,
    })
    .onConflictDoUpdate({
      target: [offers.feedId, offers.externalId],
      set: { priceCents: row.priceCents, url: row.url, priceUpdatedAt: startedAt },
    });
}
