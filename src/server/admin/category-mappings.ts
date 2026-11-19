import 'server-only';

import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

// Relative on purpose: files in src/server import each other relatively.
import { FIXED_CATEGORY_TREE } from '../../db/category-tree';
import { getDb, type Executor } from '../../db/client';
import { categories, feedCategoryMappings, feeds, offers, products } from '../../db/schema';
import { listSourcesForAdmin } from './sources';
import { parseId, textField } from './source-rules';

// The admin's view of feed category mappings, and the only admin writer of
// `feed_category_mappings` and of `products.category_id` (S4.2, guardrail 1;
// tests/unit/seams.test.ts fences both). A save writes one mapping record and
// re-applies it to the products of that feed category in one transaction. The
// only product column written is its category: no hidden, approval or review
// flag is named in this file, and publication stays the visibility scope's
// call. No feed address is read or returned (feed identity comes from
// `listSourcesForAdmin`, which masks it to a host), and no error object or
// message leaves a writer: a writer returns a fixed state or throws.

/** Where one feed category stands. `outside` is a record with a null target. */
export type CategoryRowState =
  | { kind: 'not_reviewed' }
  | { kind: 'mapped'; targetId: number; targetName: string }
  | { kind: 'outside' };

/** One of the five choosable categories, in tree order. */
export type CategoryTarget = { id: number; name: string };

export type AdminCategoryRow = {
  /** As stored on the offers or the record: trimmed, case kept. */
  feedCategory: string;
  /** Distinct products with an offer in this feed and string; 0 for a record no offer carries. */
  productCount: number;
  state: CategoryRowState;
};

export type AdminCategoryFeed = {
  id: number;
  shopName: string;
  shopApproved: boolean;
  approved: boolean;
  demo: boolean;
  /** null = a shop upload. */
  networkName: string | null;
  /** The host of the stored address, never the address. */
  host: string | null;
  hasOffers: boolean;
  /** Distinct products of this feed with an empty category cell. */
  emptyCellProducts: number;
  /** Not reviewed first, then mapped and outside scope together; see `compareRows`. */
  rows: AdminCategoryRow[];
};

export type AdminCategoryPage = { targets: CategoryTarget[]; feeds: AdminCategoryFeed[] };

export type CategoryRefusal = 'target_required' | 'target_invalid' | 'gone';

export type CategoryActionState =
  | { status: 'idle' }
  | {
      status: 'saved';
      feedId: number;
      feedCategory: string;
      previous: CategoryRowState;
      stored: CategoryRowState;
      /** null when the move cannot touch a product (not reviewed <-> outside scope). */
      productsChanged: number | null;
    }
  | { status: 'unchanged'; feedId: number; feedCategory: string; stored: CategoryRowState }
  | { status: 'refused'; reason: CategoryRefusal; feedId: number | null; feedCategory: string | null }
  | { status: 'failed'; feedId: number | null; feedCategory: string | null };

/** What a writer returns; it throws only on a database failure. */
export type CategoryWrite = Exclude<CategoryActionState, { status: 'idle' } | { status: 'failed' }>;

// ---------------------------------------------------------------- reader

const TARGET_SLUGS: string[] = FIXED_CATEGORY_TREE.children.map((child) => child.slug);

const NOT_REVIEWED: CategoryRowState = { kind: 'not_reviewed' };
const OUTSIDE: CategoryRowState = { kind: 'outside' };

function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Not reviewed before the rest; inside each group more products first, then
 * the Spanish base-letter order, then code-unit order, so "Filtros" and
 * "filtros" are never swapped between two loads.
 */
function compareRows(a: AdminCategoryRow, b: AdminCategoryRow): number {
  const rank = (row: AdminCategoryRow): number => (row.state.kind === 'not_reviewed' ? 0 : 1);
  return (
    rank(a) - rank(b) ||
    b.productCount - a.productCount ||
    a.feedCategory.localeCompare(b.feedCategory, 'es', { sensitivity: 'base' }) ||
    codeUnitOrder(a.feedCategory, b.feedCategory)
  );
}

function stateOf(record: { categoryId: number | null; name: string | null } | undefined): CategoryRowState {
  if (!record) return NOT_REVIEWED;
  if (record.categoryId === null) return OUTSIDE;
  return { kind: 'mapped', targetId: record.categoryId, targetName: record.name ?? '' };
}

/**
 * Every feed, in the "Tiendas y feeds" order, with each distinct feed category
 * its offers carry, joined to its record. Filters on no hidden or approval flag
 * (D-15). Named columns only; the feed address is never selected.
 */
export async function listCategoryMappingsForAdmin(): Promise<AdminCategoryPage> {
  const db = getDb();

  const sources = await listSourcesForAdmin();

  const targets = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(inArray(categories.slug, TARGET_SLUGS))
    .orderBy(asc(categories.position), asc(categories.id));

  const carried = await db
    .select({
      feedId: offers.feedId,
      feedCategory: offers.feedCategory,
      productCount: sql<number>`count(distinct ${offers.productId})::int`,
    })
    .from(offers)
    .where(isNotNull(offers.feedCategory))
    .groupBy(offers.feedId, offers.feedCategory);

  const emptyCells = await db
    .select({
      feedId: offers.feedId,
      productCount: sql<number>`count(distinct ${offers.productId})::int`,
    })
    .from(offers)
    .where(isNull(offers.feedCategory))
    .groupBy(offers.feedId);

  const records = await db
    .select({
      feedId: feedCategoryMappings.feedId,
      feedCategory: feedCategoryMappings.feedCategory,
      categoryId: feedCategoryMappings.categoryId,
      name: categories.name,
    })
    .from(feedCategoryMappings)
    .leftJoin(categories, eq(feedCategoryMappings.categoryId, categories.id));

  const emptyByFeed = new Map<number, number>();
  for (const group of emptyCells) emptyByFeed.set(group.feedId, Number(group.productCount));

  const rowsByFeed = new Map<number, Map<string, AdminCategoryRow>>();
  const rowsOf = (feedId: number): Map<string, AdminCategoryRow> => {
    let rows = rowsByFeed.get(feedId);
    if (!rows) {
      rows = new Map();
      rowsByFeed.set(feedId, rows);
    }
    return rows;
  };
  for (const group of carried) {
    if (group.feedCategory === null) continue;
    rowsOf(group.feedId).set(group.feedCategory, {
      feedCategory: group.feedCategory,
      productCount: Number(group.productCount),
      state: NOT_REVIEWED,
    });
  }
  for (const record of records) {
    const rows = rowsOf(record.feedId);
    const state = stateOf(record);
    const existing = rows.get(record.feedCategory);
    if (existing) existing.state = state;
    else rows.set(record.feedCategory, { feedCategory: record.feedCategory, productCount: 0, state });
  }

  const listed: AdminCategoryFeed[] = [];
  for (const shop of sources) {
    for (const feed of shop.feeds) {
      listed.push({
        id: feed.id,
        shopName: shop.name,
        shopApproved: shop.approved,
        approved: feed.approved,
        demo: feed.demo,
        networkName: feed.networkName,
        host: feed.host,
        hasOffers: feed.offerCount > 0,
        emptyCellProducts: emptyByFeed.get(feed.id) ?? 0,
        rows: [...(rowsByFeed.get(feed.id)?.values() ?? [])].sort(compareRows),
      });
    }
  }

  return { targets, feeds: listed };
}

// ---------------------------------------------------------------- writers

type Intent = 'assign' | 'outside' | 'remove';

/**
 * The feed id and the trimmed feed category of a form, each null when it cannot
 * name a row (not a well-formed id; empty or blank). Reads no other field.
 */
export function readFeedCategory(form: FormData): { feedId: number | null; feedCategory: string | null } {
  const text = textField(form, 'feedCategory').trim();
  return { feedId: parseId(form.get('feedId')), feedCategory: text === '' ? null : text };
}

/** The target id of an assign form, or the refusal that names why there is none. */
function readTarget(form: FormData): { id: number } | { refusal: 'target_required' | 'target_invalid' } {
  const raw = form.get('target');
  if (raw === null || raw === '') return { refusal: 'target_required' };
  const id = parseId(raw);
  return id === null ? { refusal: 'target_invalid' } : { id };
}

function sameState(a: CategoryRowState, b: CategoryRowState): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'mapped' || (b.kind === 'mapped' && a.targetId === b.targetId);
}

/**
 * Points every product named by `inFeedCategory` whose category is `from` (null:
 * none) at `to` (null: none), and returns how many changed. The one product
 * statement of this file: it sets a category and nothing else.
 */
async function recategorise(
  tx: Executor,
  inFeedCategory: ReturnType<typeof productsOfFeedCategory>,
  from: number | null,
  to: number | null,
): Promise<number> {
  const changed = await tx
    .update(products)
    .set({ categoryId: to })
    .where(
      and(
        from === null ? isNull(products.categoryId) : eq(products.categoryId, from),
        inArray(products.id, inFeedCategory),
      ),
    )
    .returning({ id: products.id });
  return changed.length;
}

function productsOfFeedCategory(tx: Executor, feedId: number, feedCategory: string) {
  return tx
    .select({ id: offers.productId })
    .from(offers)
    .where(and(eq(offers.feedId, feedId), eq(offers.feedCategory, feedCategory)));
}

async function writeMapping(form: FormData, intent: Intent): Promise<CategoryWrite> {
  const { feedId, feedCategory } = readFeedCategory(form);
  const refused = (reason: CategoryRefusal): CategoryWrite => ({ status: 'refused', reason, feedId, feedCategory });
  if (feedId === null || feedCategory === null) return refused('gone');

  let targetId: number | null = null;
  if (intent === 'assign') {
    const target = readTarget(form);
    if ('refusal' in target) return refused(target.refusal);
    targetId = target.id;
  }

  return getDb().transaction(async (tx): Promise<CategoryWrite> => {
    // Serialises saves on one feed (AC 25) and, with the importer's FOR SHARE,
    // keeps an import from interleaving with one. NO KEY UPDATE does not block
    // the importer's offer inserts, which only take KEY SHARE on this row.
    const feed = await tx.select({ id: feeds.id }).from(feeds).where(eq(feeds.id, feedId)).for('no key update');
    if (feed.length === 0) return refused('gone');

    let chosen: CategoryTarget | null = null;
    if (targetId !== null) {
      const found = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(and(eq(categories.id, targetId), inArray(categories.slug, TARGET_SLUGS)));
      if (found.length === 0) return refused('target_invalid');
      chosen = found[0];
    }

    const [record] = await tx
      .select({ categoryId: feedCategoryMappings.categoryId, name: categories.name })
      .from(feedCategoryMappings)
      .leftJoin(categories, eq(feedCategoryMappings.categoryId, categories.id))
      .where(and(eq(feedCategoryMappings.feedId, feedId), eq(feedCategoryMappings.feedCategory, feedCategory)));
    const previous = stateOf(record);

    // A string the screen would not list is refused (AC 8, D-14).
    if (!record) {
      const carried = await tx
        .select({ id: offers.id })
        .from(offers)
        .where(and(eq(offers.feedId, feedId), eq(offers.feedCategory, feedCategory)))
        .limit(1);
      if (carried.length === 0) return refused('gone');
    }

    const stored: CategoryRowState =
      intent === 'assign' && chosen
        ? { kind: 'mapped', targetId: chosen.id, targetName: chosen.name }
        : intent === 'outside'
          ? OUTSIDE
          : NOT_REVIEWED;
    if (sameState(previous, stored)) return { status: 'unchanged', feedId, feedCategory, stored: previous };

    if (intent === 'remove') {
      await tx
        .delete(feedCategoryMappings)
        .where(and(eq(feedCategoryMappings.feedId, feedId), eq(feedCategoryMappings.feedCategory, feedCategory)));
    } else {
      const categoryId = chosen ? chosen.id : null;
      await tx
        .insert(feedCategoryMappings)
        .values({ feedId, feedCategory, categoryId })
        .onConflictDoUpdate({
          target: [feedCategoryMappings.feedId, feedCategoryMappings.feedCategory],
          set: { categoryId },
        });
    }

    // Products: a new target fills the ones with no category (or moves the ones
    // on the old target); leaving a target clears the ones on it; a move between
    // not reviewed and outside scope touches none (AC 26 to 33).
    let productsChanged: number | null = null;
    const inFeedCategory = productsOfFeedCategory(tx, feedId, feedCategory);
    if (stored.kind === 'mapped') {
      productsChanged = await recategorise(
        tx,
        inFeedCategory,
        previous.kind === 'mapped' ? previous.targetId : null,
        stored.targetId,
      );
    } else if (previous.kind === 'mapped') {
      productsChanged = await recategorise(tx, inFeedCategory, previous.targetId, null);
    }

    return { status: 'saved', feedId, feedCategory, previous, stored, productsChanged };
  });
}

/** Maps a feed category to one of the five categories, or moves it to another. Field `target`. */
export function assignCategory(form: FormData): Promise<CategoryWrite> {
  return writeMapping(form, 'assign');
}

/** Marks a feed category outside scope: reviewed, mapped to nothing. */
export function markOutsideScope(form: FormData): Promise<CategoryWrite> {
  return writeMapping(form, 'outside');
}

/** Removes a feed category's record, which returns it to not reviewed. */
export function removeCategoryMapping(form: FormData): Promise<CategoryWrite> {
  return writeMapping(form, 'remove');
}
