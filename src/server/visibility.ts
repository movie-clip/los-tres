import 'server-only';

import { and, eq, exists, isNotNull, not, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';

import { collectedRowsShown } from '../config/local-flag';
import { feeds, offers, products, shops, vehicles } from '../db/schema';

// The one visibility scope (guardrail 1). Every public read applies these
// conditions and none restates a flag. Outside this file only the schema, the
// seed, the importer and the two admin writers (src/server/admin/sources.ts for
// approvals, src/server/admin/products.ts for the hidden flags) may name the
// approval, hidden and review columns.
//
//   offer visible   = feed approved AND shop approved AND offer not hidden
//                     AND offer not in the matching queue AND offer not
//                     removed by import (S3.3)
//   product public = product not hidden AND product mapped to a category
//                     (products.category_id is not null) AND it has at least
//                     one visible offer
//   fitment counted = feed approved AND shop approved AND vehicle not retired
//                     AND feed not a collected feed (no offer or product flag:
//                     a fitment never makes a product public, S5.5)
//
// Marked rows (S12.2, decision 0017): an offer of a collected feed and a product
// created from a row of one. Both scopes leave them out unless the local flag is
// on beside a loopback SITE_URL (`collectedRowsShown`, read on every call); the
// flag lifts that exclusion and no other rule. A collected feed's fitment never
// counts, flag on or off.

/** Condition over `feeds`: the feed is a collected feed. Flag-independent. */
export function markedFeedSql(): SQL {
  return eq(feeds.sourceType, 'collected_file');
}

/** Condition over `products`: the product was created from a collected row. Flag-independent. */
export function markedProductSql(): SQL {
  return eq(products.isCollected, true);
}

// The not-public reason (US-2.5). Each scope is one rule table: a rule is a
// cause and the condition that holds while that cause does not apply. The
// public condition is the AND of its table, and the admin's reason is the
// first rule of the same table that fails, so the two cannot disagree. A rule
// added to a table needs a cause, and a new cause needs a new reason code. A
// row that is not public for a cause no table names reads `unknown`, never a
// blank (US-2.5 ACs 5, 8, 9). Order is the owner's (D-1).

/** Offer causes, in the order a reason names them (D-1). */
export const OFFER_CAUSES = [
  'shop_not_approved',
  'feed_not_approved',
  'collected',
  'removed',
  'hidden',
  'in_review',
] as const;
export type OfferCause = (typeof OFFER_CAUSES)[number];

/** Product causes of its own, in the order a reason names them (D-1). */
export const PRODUCT_CAUSES = ['no_category', 'collected', 'hidden'] as const;
export type ProductCause = (typeof PRODUCT_CAUSES)[number];

/** Reason on an offer row: its own cause first, else its product's own cause. */
export type OfferNotPublicReason = `offer_${OfferCause}` | `product_${ProductCause}` | 'unknown';
/** Reason on a product (list row and product block). */
export type ProductNotPublicReason =
  | `product_${ProductCause}`
  | 'product_no_offers'
  | `offers_${OfferCause}`
  | 'unknown';
export type NotPublicReason = OfferNotPublicReason | ProductNotPublicReason;

const offerCode = (cause: OfferCause) => `offer_${cause}` as const;
const productCode = (cause: ProductCause) => `product_${cause}` as const;
const offersCode = (cause: OfferCause) => `offers_${cause}` as const;

/** Every reason an offer row can carry. */
export const OFFER_NOT_PUBLIC_REASONS: readonly OfferNotPublicReason[] = [
  ...OFFER_CAUSES.map(offerCode),
  ...PRODUCT_CAUSES.map(productCode),
  'unknown',
];

/** Every reason a product can carry. */
export const PRODUCT_NOT_PUBLIC_REASONS: readonly ProductNotPublicReason[] = [
  ...PRODUCT_CAUSES.map(productCode),
  'product_no_offers',
  ...OFFER_CAUSES.map(offersCode),
  'unknown',
];

/** The closed set, all 17 codes, each once. */
export const NOT_PUBLIC_REASONS: readonly NotPublicReason[] = [
  ...OFFER_CAUSES.map(offerCode),
  ...PRODUCT_CAUSES.map(productCode),
  'product_no_offers',
  ...OFFER_CAUSES.map(offersCode),
  'unknown',
];

/** One rule: the cause, and the condition that holds while it does not apply. */
export type Rule<C> = { cause: C; holds: SQL };

type MaybeRule<C> = { cause: C; holds: SQL | undefined };

const present = <C>(rules: MaybeRule<C>[]): Rule<C>[] =>
  rules.filter((rule): rule is Rule<C> => rule.holds !== undefined);

/** The AND of a rule table: the public condition it stands for. */
const allHold = <C>(rules: Rule<C>[]): SQL => and(...rules.map((rule) => rule.holds)) as SQL;

/**
 * The offer table over `offers` ⋈ `feeds` ⋈ `shops`. `collected` is the
 * collected rule's condition for one flag reading, absent when collected rows
 * are shown.
 */
function offerRuleTable(collected: SQL | undefined): Rule<OfferCause>[] {
  return present<OfferCause>([
    { cause: 'shop_not_approved', holds: eq(shops.isApproved, true) },
    { cause: 'feed_not_approved', holds: eq(feeds.isApproved, true) },
    { cause: 'collected', holds: collected },
    { cause: 'removed', holds: eq(offers.isRemoved, false) },
    { cause: 'hidden', holds: eq(offers.isHidden, false) },
    { cause: 'in_review', holds: eq(offers.inReview, false) },
  ]);
}

/** The offers of the current product, over `offers` ⋈ `feeds` ⋈ `shops`, filtered by `where`. */
function productOffers(select: Record<string, SQL>, where?: SQL) {
  return new QueryBuilder()
    .select(select)
    .from(offers)
    .innerJoin(feeds, eq(offers.feedId, feeds.id))
    .innerJoin(shops, eq(feeds.shopId, shops.id))
    .where(and(eq(offers.productId, products.id), where));
}

/**
 * The product table over `products`. `collected` is the collected rule's
 * condition for one flag reading, and `shown` the same reading, passed to the
 * inner offer scope.
 */
function productRuleTable(
  collected: SQL | undefined,
  shown: boolean,
): Rule<ProductCause | 'has_visible_offer'>[] {
  return present<ProductCause | 'has_visible_offer'>([
    { cause: 'no_category', holds: isNotNull(products.categoryId) },
    { cause: 'collected', holds: collected },
    { cause: 'hidden', holds: eq(products.isHidden, false) },
    {
      cause: 'has_visible_offer',
      holds: exists(productOffers({ one: sql`1` }, allHold(offerRules(shown)))),
    },
  ]);
}

/** The offer rules, in D-1 order. The collected rule is omitted when `shown` is true. */
export function offerRules(shown: boolean = collectedRowsShown()): Rule<OfferCause>[] {
  return offerRuleTable(shown ? undefined : not(markedFeedSql()));
}

/** The product rules: no_category, collected (omitted when `shown`), hidden, has_visible_offer. */
export function productRules(shown: boolean = collectedRowsShown()): Rule<ProductCause | 'has_visible_offer'>[] {
  return productRuleTable(shown ? undefined : not(markedProductSql()), shown);
}

/**
 * Condition over `offers` joined to `feeds` (offers.feed_id) and `shops`
 * (feeds.shop_id): the offer may be shown to the public. The AND of the offer
 * table; the flag test stays written here, where the scope reads it.
 */
export function visibleOfferWhere(): SQL {
  return allHold(offerRuleTable(collectedRowsShown() ? undefined : not(markedFeedSql())));
}

/**
 * Condition over `products`: the product may be shown to the public. The AND
 * of the product table, with the flag read once for it and its offer scope.
 */
export function visibleProductWhere(): SQL {
  const collected = collectedRowsShown() ? undefined : not(markedProductSql());
  return allHold(productRuleTable(collected, collected === undefined));
}

/** A code from the closed set as an SQL string literal. Never input: only constants reach it. */
const codeLiteral = (code: NotPublicReason): SQL => sql.raw(`'${code}'`);

/**
 * The shared CASE: the code of the first failing branch, else `unknown` while
 * the row is not public, else null. So a row that is not public is never
 * without a reason, and a public row never has one.
 */
export function reasonCaseSql(branches: { failing: SQL; code: SQL }[], isPublic: SQL): SQL {
  const whens = branches.map(({ failing, code }) => sql`when ${failing} then ${code}`);
  return sql`(case ${sql.join(whens, sql` `)} when not coalesce((${isPublic}), false) then ${codeLiteral('unknown')} else null end)`;
}

const fails = (rule: Rule<unknown>): SQL => sql`not (${rule.holds})`;

/**
 * Over `offers` ⋈ `feeds` ⋈ `shops` ⋈ `products`: why the public product page
 * does not list the offer, or null when it does. The offer's own causes come
 * first, then its product's own causes.
 */
export function offerNotPublicReasonSql(): SQL<OfferNotPublicReason | null> {
  const shown = collectedRowsShown();
  const offerTable = offerRules(shown);
  const productTable = productRules(shown);
  const branches = [
    ...offerTable.map((rule) => ({ failing: fails(rule), code: codeLiteral(offerCode(rule.cause)) })),
    ...productTable.flatMap((rule) =>
      rule.cause === 'has_visible_offer' ? [] : [{ failing: fails(rule), code: codeLiteral(productCode(rule.cause)) }],
    ),
  ];
  const isPublic = sql`(${allHold(offerTable)}) and (${allHold(productTable)})`;
  return reasonCaseSql(branches, isPublic) as SQL<OfferNotPublicReason | null>;
}

/**
 * Over `products`: why the public product page does not answer with the
 * product, or null when it does. When no offer of it is public, the reason is
 * `product_no_offers` if it has no offer row at all, else the cause of its
 * first-ranked offer (D-2): the lowest rank of any offer's first failing rule.
 */
export function productNotPublicReasonSql(): SQL<ProductNotPublicReason | null> {
  const shown = collectedRowsShown();
  const offerTable = offerRules(shown);
  const productTable = productRules(shown);

  const rank = sql`case ${sql.join(
    offerTable.map((rule, index) => sql`when ${fails(rule)} then ${sql.raw(String(index + 1))}`),
    sql` `,
  )} end`;
  const decode = sql.join(
    offerTable.map((rule, index) => sql`when ${sql.raw(String(index + 1))} then ${codeLiteral(offersCode(rule.cause))}`),
    sql` `,
  );
  const firstOfferCause = sql`case when not ${exists(productOffers({ one: sql`1` }))} then ${codeLiteral('product_no_offers')} else case (${productOffers({ rank: sql`min(${rank})` })}) ${decode} else ${codeLiteral('unknown')} end end`;

  const branches = productTable.map((rule) => ({
    failing: fails(rule),
    code: rule.cause === 'has_visible_offer' ? firstOfferCause : codeLiteral(productCode(rule.cause)),
  }));
  return reasonCaseSql(branches, allHold(productTable)) as SQL<ProductNotPublicReason | null>;
}

/** Maps a driver value to the closed set (or to `allowed`): a member, null, or `unknown` for anything else. */
export function toNotPublicReason(value: unknown): NotPublicReason | null;
export function toNotPublicReason<T extends NotPublicReason>(value: unknown, allowed: readonly T[]): T | 'unknown' | null;
export function toNotPublicReason(
  value: unknown,
  allowed: readonly NotPublicReason[] = NOT_PUBLIC_REASONS,
): NotPublicReason | null {
  if (value === null || value === undefined) return null;
  return allowed.find((code) => code === value) ?? 'unknown';
}

/** Condition over `vehicles`: the vehicle is in the current list (not retired). */
export function activeVehicleWhere(): SQL {
  return eq(vehicles.isRetired, false);
}

/**
 * Condition over `fitments` joined to `feeds` (fitments.feed_id), `shops`
 * (feeds.shop_id) and `vehicles` (fitments.vehicle_id): the fitment counts.
 * It names no offer or product flag, so it never decides what is public. A
 * collected feed's fitment never counts, whatever the local flag says (AC 32).
 */
export function countedFitmentWhere(): SQL {
  return and(
    eq(feeds.isApproved, true),
    eq(shops.isApproved, true),
    activeVehicleWhere(),
    not(markedFeedSql()),
  ) as SQL;
}
