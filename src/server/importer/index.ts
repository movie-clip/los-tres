import 'server-only';

import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type { Database, Executor } from '../../db/client';
import { feedCategoryMappings, feeds, offers, products, shops } from '../../db/schema';
import { matchProduct, normalizeBrand, normalizePartNumber, selectByEan, type MatchScope } from '../matching';
import { slugify, uniqueSlug } from '../slug';
import { decideEanFill, type EanFillDecision, type EanFillFacts } from './ean-fill';
import { FeedFitments, loadVehicleIds, replaceFeedFitments } from './fitments';
import { openRecords, type FeedRecords } from './records';
import { decideRemoval, REMOVAL_CHUNK } from './removal';
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
// The only writer of `offers.is_removed` (S3.3): set on this feed's offers that
// are absent from an import that passed the removal guard (./removal.ts), and
// cleared on every accepted row.
// Product text is written once (TD-23), except an empty EAN, which
// `fillEmptyEan` may set once (S7.6). `products.category_id` is the one
// product column it may set later, and only from null: the first mapped feed
// category wins and nothing is ever cleared or overwritten (D-3). The admin
// mapping writer (src/server/admin/category-mappings.ts, S4.2) is the second
// and only other writer of that column: it alone moves or clears a category,
// when an admin saves a mapping. An outside-scope mapping (null target) is no
// mapping here: the row is stored with no category.
// The only writer of `fitments` (through ./fitments.ts); a feed replaces only
// its own fitments for the products its accepted rows name; products it does
// not name keep theirs.

export { FeedNotRegisteredError, formatImportReport, importExitCode };
export type { FeedImportReport, ImportDeps, ImportReport, RejectedRow };

type FeedRow = {
  id: number;
  url: string;
  isDemo: boolean;
  sourceType: FeedSourceRef['sourceType'];
  isApproved: boolean;
  shopName: string;
  /** The feed's shop approval, read once per run for the EAN fill (S7.6). */
  shopApproved: boolean;
};

/**
 * Imports the approved feeds in id order, or the one feed `options.feedId`
 * (throws `FeedNotRegisteredError` when no such row exists; a row that exists
 * but is not approved is reported `skipped` and its source is not read).
 * One transaction per feed; a failing feed never stops the others.
 * `allowLargeRemoval` lifts the small-import removal guard for the feed
 * `options.feedId` only; with no `feedId` it has no effect (S3.3, D-3).
 */
export async function importFeeds(
  db: Database,
  options: { feedId?: number; allowLargeRemoval?: boolean; deps?: ImportDeps } = {},
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
    const allowLargeRemoval =
      options.allowLargeRemoval === true && options.feedId !== undefined && feed.id === options.feedId;
    reports.push(await importOneFeed(db, feed, readSource, startedAt, allowLargeRemoval));
  }
  return { startedAt, feeds: reports };
}

async function loadFeeds(db: Executor, feedId: number | undefined): Promise<FeedRow[]> {
  const rows = db
    .select({
      id: feeds.id,
      url: feeds.url,
      isDemo: feeds.isDemo,
      sourceType: feeds.sourceType,
      isApproved: feeds.isApproved,
      shopName: shops.name,
      shopApproved: shops.isApproved,
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
    offersRemoved: 0,
    rejected: [],
    ownProducts: [],
    eanFilled: 0,
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
  allowLargeRemoval: boolean,
): Promise<FeedImportReport> {
  if (!feed.isApproved) {
    return { ...emptyReport(feed), outcome: 'skipped', skipReason: 'not_approved' };
  }

  // Opening (gzip, format, the CSV header) happens before the transaction, so a
  // feed with no usable header fails without a transaction. The errors are
  // dropped: they may name the URL, which can hold an API key.
  let opened: FeedRecords;
  try {
    const bytes = await readSource({
      id: feed.id,
      url: feed.url,
      isDemo: feed.isDemo,
      sourceType: feed.sourceType,
    });
    opened = await openRecords(bytes);
  } catch (error) {
    return failed(feed, failureOf(error, 'fetch_failed'));
  }

  try {
    const columns = opened.header ? readHeader(opened.header) : null;
    if (!columns) return failed(feed, 'invalid_header');
    try {
      return await db.transaction((tx) =>
        importRecords(tx, feed, columns, opened.records, startedAt, allowLargeRemoval),
      );
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
  allowLargeRemoval: boolean,
): Promise<FeedImportReport> {
  const report = emptyReport(feed);
  const seenIds = new Set<string>();
  // S12.2 (D-1): the feed's kind decides the marker. Every product a collected feed's row creates is
  // marked; an offer is marked through its feed, which it never leaves, so it needs no write of its own.
  const markedRow = feed.sourceType === 'collected_file';
  // Shares the feed row until this transaction ends, so an admin mapping save
  // (FOR NO KEY UPDATE on the same row) cannot run between loading the mappings
  // and writing categories: an import never refills what a save just cleared
  // (S4.2, D-16).
  await tx.select({ id: feeds.id }).from(feeds).where(eq(feeds.id, feed.id)).for('share');
  const mappings = await loadMappings(tx, feed.id);
  // Read before the row loop, so offers created or restored by it are not in it.
  const liveOffers = await loadLiveOffers(tx, feed.id);
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
      await assignCategory(tx, known.productId, mappedCategory(mappings, row), { markedRow });
      const fill = decideEanFill(fillFacts(feed, row, markedRow, known.offer, known.product));
      if (await fillEmptyEan(tx, known.productId, fill, { markedRow })) report.eanFilled += 1;
      fitmentsOfFeed.add(known.productId, row.fitment);
      report.offersUpdated += 1;
      continue;
    }

    const brandNormalised = normalizeBrand(row.brand);
    const partNumberNormalised = normalizePartNumber(row.partNumber);
    const match = await matchProduct(
      tx,
      { eanNormalised: row.eanNormalised, brandNormalised, partNumberNormalised },
      { markedRow },
    );

    let productId: number;
    if (match.kind === 'attach') {
      productId = match.productId;
    } else {
      productId = await createProduct(tx, row, brandNormalised, partNumberNormalised, markedRow);
      report.productsCreated += 1;
      if (match.kind === 'own_product') report.ownProducts.push({ record, reason: match.reason });
    }
    await writeOffer(tx, feed.id, productId, row, startedAt);
    await assignCategory(tx, productId, mappedCategory(mappings, row), { markedRow });
    // A created product already carries the row's EAN, or the row had none: only an attach may fill.
    if (match.kind === 'attach' && row.eanNormalised !== null) {
      const target = await readFillTarget(tx, productId);
      if (target) {
        const fill = decideEanFill(fillFacts(feed, row, markedRow, NEW_OFFER, target));
        if (await fillEmptyEan(tx, productId, fill, { markedRow })) report.eanFilled += 1;
      }
    }
    fitmentsOfFeed.add(productId, row.fitment);
    report.offersCreated += 1;
  }
  await removeMissingOffers(tx, feed.id, liveOffers, seenIds, allowLargeRemoval, report);
  await replaceFeedFitments(tx, feed.id, fitmentsOfFeed.wanted);
  fitmentsOfFeed.fillReport(report);
  return report;
}

/**
 * This feed's mappings: the feed's category string to our category id. A
 * string marked outside scope (null target) is left out, so it maps to nothing.
 */
async function loadMappings(tx: Executor, feedId: number): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      feedCategory: feedCategoryMappings.feedCategory,
      categoryId: feedCategoryMappings.categoryId,
    })
    .from(feedCategoryMappings)
    .where(and(eq(feedCategoryMappings.feedId, feedId), isNotNull(feedCategoryMappings.categoryId)));
  const mappings = new Map<string, number>();
  for (const mapping of rows) {
    if (mapping.categoryId !== null) mappings.set(mapping.feedCategory, mapping.categoryId);
  }
  return mappings;
}

/** The category the row's feed category maps to, or null (absent or unmapped). */
function mappedCategory(mappings: Map<string, number>, row: ValidRow): number | null {
  return row.feedCategory === null ? null : (mappings.get(row.feedCategory) ?? null);
}

/**
 * Sets the product's category only while it has none: first mapped wins, an
 * existing category is never overwritten and none is ever cleared (D-3). A row
 * of a collected feed sets only a marked product's category, never an unmarked
 * one's that its offer attached to (S12.2, DS-9).
 */
async function assignCategory(
  tx: Executor,
  productId: number,
  categoryId: number | null,
  scope: MatchScope,
): Promise<void> {
  if (categoryId === null) return;
  await tx
    .update(products)
    .set({ categoryId })
    .where(
      and(
        eq(products.id, productId),
        isNull(products.categoryId),
        scope.markedRow ? eq(products.isCollected, true) : undefined,
      ),
    );
}

/** This feed's offers not flagged removed (hidden and in-review included): external id to offer id. */
async function loadLiveOffers(tx: Executor, feedId: number): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: offers.id, externalId: offers.externalId })
    .from(offers)
    .where(and(eq(offers.feedId, feedId), eq(offers.isRemoved, false)));
  return new Map(rows.map((row) => [row.externalId, row.id]));
}

/**
 * The removal pass (S3.3): flags this feed's live offers that no accepted row
 * named, unless the guard skips it. Writes `is_removed` only, never a hidden or
 * review flag, and never an offer of another feed. Runs in the feed's
 * transaction, so a later failure rolls it back with the import.
 */
async function removeMissingOffers(
  tx: Executor,
  feedId: number,
  liveOffers: Map<string, number>,
  seenIds: Set<string>,
  allowLargeRemoval: boolean,
  report: FeedImportReport,
): Promise<void> {
  const missingIds: number[] = [];
  for (const [externalId, offerId] of liveOffers) {
    if (!seenIds.has(externalId)) missingIds.push(offerId);
  }
  const decision = decideRemoval({
    current: liveOffers.size,
    missing: missingIds.length,
    accepted: seenIds.size,
    allowLargeRemoval,
  });
  if (decision.kind === 'skip') {
    report.removalSkipped = {
      reason: decision.reason,
      missing: missingIds.length,
      current: liveOffers.size,
    };
    return;
  }
  if (decision.kind === 'none') return;
  for (let start = 0; start < missingIds.length; start += REMOVAL_CHUNK) {
    const chunk = missingIds.slice(start, start + REMOVAL_CHUNK);
    const flagged = await tx
      .update(offers)
      .set({ isRemoved: true })
      .where(and(eq(offers.feedId, feedId), inArray(offers.id, chunk)))
      .returning({ id: offers.id });
    report.offersRemoved += flagged.length;
  }
}

type FillTarget = EanFillFacts['product'];
type FillOffer = EanFillFacts['offer'];

/** A new offer's states: the insert sets neither, and the schema defaults both to false. */
const NEW_OFFER: FillOffer = { isHidden: false, inReview: false };

/** The four product columns the EAN fill decides on (S7.6), by product id. */
const fillTargetColumns = {
  ean: products.ean,
  eanNormalised: products.eanNormalised,
  isHidden: products.isHidden,
  marked: products.isCollected,
};

/**
 * This feed's stored offer for the external id, with its own states and the
 * product it sits on (S7.6): one statement, the product joined by its key.
 */
async function findOffer(
  tx: Executor,
  feedId: number,
  externalId: string,
): Promise<{ productId: number; offer: FillOffer; product: FillTarget } | undefined> {
  const [found] = await tx
    .select({
      productId: offers.productId,
      offerHidden: offers.isHidden,
      offerInReview: offers.inReview,
      ...fillTargetColumns,
    })
    .from(offers)
    .innerJoin(products, eq(offers.productId, products.id))
    .where(and(eq(offers.feedId, feedId), eq(offers.externalId, externalId)))
    .limit(1);
  if (!found) return undefined;
  return {
    productId: found.productId,
    offer: { isHidden: found.offerHidden, inReview: found.offerInReview },
    product: {
      ean: found.ean,
      eanNormalised: found.eanNormalised,
      isHidden: found.isHidden,
      marked: found.marked,
    },
  };
}

/** The product a new offer attached to, as the EAN fill reads it (S7.6). */
async function readFillTarget(tx: Executor, productId: number): Promise<FillTarget | undefined> {
  const [found] = await tx.select(fillTargetColumns).from(products).where(eq(products.id, productId)).limit(1);
  return found;
}

/** The facts of one accepted row for `decideEanFill` (S7.6). */
function fillFacts(
  feed: FeedRow,
  row: ValidRow,
  markedRow: boolean,
  offer: FillOffer,
  product: FillTarget,
): EanFillFacts {
  return {
    row: { ean: row.ean, eanNormalised: row.eanNormalised },
    markedRow,
    shopApproved: feed.shopApproved,
    feedApproved: feed.isApproved,
    offer,
    product,
  };
}

/**
 * Fills an empty EAN once (S7.6): never another column, never a set EAN. True
 * when it wrote. No fill while another product the row's matching lookup can
 * see holds the EAN, hidden ones included (D-4). The update repeats the
 * product states another transaction can change, both EAN columns null and not
 * hidden, as its own guard (DT-5).
 */
async function fillEmptyEan(
  tx: Executor,
  productId: number,
  decision: EanFillDecision,
  scope: MatchScope,
): Promise<boolean> {
  if (decision.kind === 'skip') return false;
  if ((await selectByEan(tx, decision.eanNormalised, scope)).length > 0) return false;
  const filled = await tx
    .update(products)
    .set({ ean: decision.ean, eanNormalised: decision.eanNormalised })
    .where(
      and(
        eq(products.id, productId),
        isNull(products.ean),
        isNull(products.eanNormalised),
        eq(products.isHidden, false),
      ),
    )
    .returning({ id: products.id });
  return filled.length === 1;
}

/**
 * Product text is written here only, once, and never updated (TD-23), except
 * an empty EAN, which `fillEmptyEan` may set once (S7.6). So is the collected
 * marker (S12.2): `markedRow` is true for a row of a collected feed.
 */
async function createProduct(
  tx: Executor,
  row: ValidRow,
  brandNormalised: string | null,
  partNumberNormalised: string | null,
  markedRow: boolean,
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
      partNumberNormalised,
      ean: row.ean,
      eanNormalised: row.eanNormalised,
      description: row.description,
      isCollected: markedRow,
    })
    .returning({ id: products.id });
  return created.id;
}

/**
 * Upserts on (feed_id, external_id). The update lists exactly price, url, date,
 * feed_category (all feed data) and the removed flag, cleared because the row
 * is in this import (S3.3): never product_id, is_hidden or in_review (TD-21,
 * TD-24). An insert takes the removed flag's default, false.
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
        isRemoved: false,
      },
    });
}
