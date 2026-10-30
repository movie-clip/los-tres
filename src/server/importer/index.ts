import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';

import type { Database, Executor } from '../../db/client';
import { feedCategoryMappings, feeds, offers, products, shops } from '../../db/schema';
import { matchProduct, normalizeBrand, normalizePartNumber } from '../matching';
import { slugify, uniqueSlug } from '../slug';
import { FeedFitments, loadVehicleIds, replaceFeedFitments } from './fitments';
import { openRecords, type FeedRecords } from './records';
import { formatImportReport, importExitCode } from './report';
import { readFeedSource, SourceError } from './source';
import {
  FeedFormatError,
  FeedNotRegisteredError,
  type FeedBytes,
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
// Product text is written once (TD-23). `products.category_id` is the one
// product column it may set later, and only from null: the first mapped feed
// category wins and nothing is ever cleared or overwritten (D-3).
// The only writer of `fitments` (through ./fitments.ts); a feed replaces only
// its own fitments for the products its accepted rows name; products it does
// not name keep theirs.

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
    unknownVehicles: 0,
    unknownVehicleSlugs: [],
    unknownVehiclesNotShown: 0,
  };
}

function failed(feed: FeedRow, failure: FeedFailure): FeedImportReport {
  return { ...emptyReport(feed), outcome: 'failed', failure };
}

async function importOneFeed(
  db: Database,
  feed: FeedRow,
  readSource: (feed: FeedSourceRef) => Promise<FeedBytes>,
  startedAt: Date,
): Promise<FeedImportReport> {
  if (!feed.isApproved) {
    return { ...emptyReport(feed), outcome: 'skipped', skipReason: 'not_approved' };
  }

  // Opening (gzip, format, the CSV header) happens before the transaction, so a
  // feed with no usable header fails without a transaction. The errors are
  // dropped: they may name the URL, which can hold an API key.
  let opened: FeedRecords;
  try {
    const bytes = await readSource({ id: feed.id, url: feed.url, isDemo: feed.isDemo });
    opened = await openRecords(bytes);
  } catch (error) {
    return failed(feed, failureOf(error, 'fetch_failed'));
  }

  try {
    const columns = opened.header ? readHeader(opened.header) : null;
    if (!columns) return failed(feed, 'invalid_header');
    try {
      return await db.transaction((tx) => importRecords(tx, feed, columns, opened.records, startedAt));
    } catch (error) {
      // Rolled back, whatever was written. The error is dropped: a driver
      // message can carry row values. A read failure part-way (bad gzip or XML,
      // a cap, a dropped connection) keeps its own code; the rest is the database.
      return failed(feed, failureOf(error, 'database_error'));
    }
  } finally {
    await opened.close();
  }
}

/** The report's failure for an error from the source or the format readers, else `otherwise`. */
function failureOf(error: unknown, otherwise: FeedFailure): FeedFailure {
  return error instanceof SourceError || error instanceof FeedFormatError ? error.code : otherwise;
}

async function importRecords(
  tx: Executor,
  feed: FeedRow,
  columns: ColumnIndex,
  records: FeedRecords['records'],
  startedAt: Date,
): Promise<FeedImportReport> {
  const report = emptyReport(feed);
  const seenIds = new Set<string>();
  const mappings = await loadMappings(tx, feed.id);
  const fitmentsOfFeed = new FeedFitments(await loadVehicleIds(tx));

  for await (const { record, cells } of records) {
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
      await assignCategory(tx, known.productId, mappedCategory(mappings, row));
      fitmentsOfFeed.add(known.productId, row.fitment);
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
    await assignCategory(tx, productId, mappedCategory(mappings, row));
    fitmentsOfFeed.add(productId, row.fitment);
    report.offersCreated += 1;
  }
  await replaceFeedFitments(tx, feed.id, fitmentsOfFeed.wanted);
  fitmentsOfFeed.fillReport(report);
  return report;
}

/** This feed's mappings: the feed's category string to our category id. */
async function loadMappings(tx: Executor, feedId: number): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      feedCategory: feedCategoryMappings.feedCategory,
      categoryId: feedCategoryMappings.categoryId,
    })
    .from(feedCategoryMappings)
    .where(eq(feedCategoryMappings.feedId, feedId));
  return new Map(rows.map((mapping) => [mapping.feedCategory, mapping.categoryId]));
}

/** The category the row's feed category maps to, or null (absent or unmapped). */
function mappedCategory(mappings: Map<string, number>, row: ValidRow): number | null {
  return row.feedCategory === null ? null : (mappings.get(row.feedCategory) ?? null);
}

/**
 * Sets the product's category only while it has none: first mapped wins, an
 * existing category is never overwritten and none is ever cleared (D-3).
 */
async function assignCategory(
  tx: Executor,
  productId: number,
  categoryId: number | null,
): Promise<void> {
  if (categoryId === null) return;
  await tx
    .update(products)
    .set({ categoryId })
    .where(and(eq(products.id, productId), isNull(products.categoryId)));
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
 * Upserts on (feed_id, external_id). The update lists exactly price, url, date
 * and feed_category (all feed data): never product_id, is_hidden or in_review
 * (TD-21, TD-24).
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
      feedCategory: row.feedCategory,
      priceUpdatedAt: startedAt,
    })
    .onConflictDoUpdate({
      target: [offers.feedId, offers.externalId],
      set: {
        priceCents: row.priceCents,
        url: row.url,
        feedCategory: row.feedCategory,
        priceUpdatedAt: startedAt,
      },
    });
}
