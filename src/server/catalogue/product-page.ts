import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories, feeds, offers, products, shops } from '../../db/schema';
import {
  ACEA_SEQUENCES,
  ENGINE_OIL_CATEGORY,
  formatVolumeMl,
  OIL_TYPES,
  VISCOSITY_GRADES,
  type AceaSequence,
  type OilType,
  type ViscosityGrade,
} from '../category-attributes';
import { isWellFormedSlug } from '../slug';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';
import { bestPriceFlags } from './best-price';
import { readCategoryTrail, type PublicCategoryCrumb } from './category-trail';
import { indexableProductWhere } from './demo';

// The backend/frontend contract for the product page (C-11). The page formats;
// this returns integer cents and `Date`, never a formatted amount or date.

export type { PublicCategoryCrumb };

export type PublicOffer = {
  /** offers.id; the page links to it through /go (goPath), never to a shop URL. */
  offerId: number;
  /** shops.name */
  shopName: string;
  /** Integer, > 0, EUR, IVA included. Never a formatted string. */
  priceCents: number;
  /** offers.price_updated_at */
  priceUpdatedAt: Date;
  /** bestPriceFlags (best-price.ts) over the visible offers' priceCents. */
  isBestPrice: boolean;
};

/**
 * The engine-oil attributes as the page shows them (S15.3, 06-ux § Data needs).
 * Null = the product holds none for that attribute; an array is never empty.
 */
export type ProductAttributes = {
  /** Written form, '10W-40'. */
  viscosity: ViscosityGrade | null;
  /** Written form from formatVolumeMl, '1,5 l' (plain space). */
  volume: string | null;
  /** Closed-set order, as held. */
  acea: readonly AceaSequence[] | null;
  /** Family key, never a Spanish word; the page maps it to its message. */
  oilType: OilType | null;
  /** As held, feed order. Plain text: the page must render each as text, never as HTML. */
  approvals: readonly string[] | null;
};

export type PublicProductPage = {
  slug: string;
  /** Never empty. */
  title: string;
  /** Trimmed; null when null or blank. */
  brand: string | null;
  /** Trimmed; null when null or blank, for example "OC 1234". */
  partNumber: string | null;
  /** Trimmed; null when null or blank. */
  ean: string | null;
  /** Trimmed; null when null or blank. Plain text: the page must render it as text, never as HTML. */
  description: string | null;
  /** categories.slug of the product's own category; equals categoryTrail.at(-1).slug. */
  categorySlug: string;
  /** Root first, ends with the product's own category. Length >= 1. */
  categoryTrail: PublicCategoryCrumb[];
  /** Length >= 1, visible offers only, already sorted by price, shop, id. */
  offers: PublicOffer[];
  /** True when every listed (visible) offer is from a demo feed. offers.length >= 1, so never vacuous. */
  demoOnly: boolean;
  /**
   * True when the product has an offer, in any state, from a non-demo feed:
   * search engines may index the page (canonical) and the sitemap lists it.
   * False means noindex. Never null. Independent of `demoOnly`, which drives
   * the demo notice only.
   */
  indexable: boolean;
  /**
   * Null when categorySlug is not ENGINE_OIL_CATEGORY, or when the product
   * holds none of the five. When non-null, at least one field is non-null.
   * Decided here, once; the page draws what it receives (S15.3, D-26).
   */
  attributes: ProductAttributes | null;
};

function nonBlank(value: string | null): string | null {
  return value?.trim() || null;
}

type HeldAttributes = {
  viscosity: string | null;
  volumeMl: number | null;
  acea: string[] | null;
  oilType: string | null;
  approvals: string[] | null;
};

const ACEA_TOKENS: readonly string[] = ACEA_SEQUENCES.map((sequence) => sequence.token);

function isAceaSequence(value: string): value is AceaSequence {
  return ACEA_TOKENS.includes(value);
}

function isOilType(value: string): value is OilType {
  return (OIL_TYPES as readonly string[]).includes(value);
}

function isViscosityGrade(value: string): value is ViscosityGrade {
  return (VISCOSITY_GRADES as readonly string[]).includes(value);
}

function nonEmpty<T>(values: readonly T[] | null): readonly T[] | null {
  return values && values.length > 0 ? values : null;
}

/**
 * The page's attributes: only in aceite-de-motor, and null when none is held.
 * A stored value outside its closed set (only the importer writes them, from
 * the readers) is treated as absent rather than shown.
 */
function pageAttributes(categorySlug: string, held: HeldAttributes): ProductAttributes | null {
  if (categorySlug !== ENGINE_OIL_CATEGORY) return null;
  const attributes: ProductAttributes = {
    viscosity: held.viscosity !== null && isViscosityGrade(held.viscosity) ? held.viscosity : null,
    volume: held.volumeMl === null ? null : formatVolumeMl(held.volumeMl),
    acea: nonEmpty(held.acea?.filter(isAceaSequence) ?? null),
    oilType: held.oilType !== null && isOilType(held.oilType) ? held.oilType : null,
    approvals: nonEmpty(held.approvals),
  };
  return Object.values(attributes).some((value) => value !== null) ? attributes : null;
}

/**
 * The public page of one product, or `null` for every not-public reason alike:
 * malformed slug (rejected before any query), unknown slug, hidden product, or
 * no visible offer. The caller cannot tell which, by design (TD-31).
 */
export async function getPublicProductBySlug(slug: string): Promise<PublicProductPage | null> {
  if (!isWellFormedSlug(slug)) return null;

  const rows = await getDb()
    .select({
      slug: products.slug,
      title: products.title,
      brand: products.brand,
      partNumber: products.partNumber,
      ean: products.ean,
      description: products.description,
      categorySlug: categories.slug,
      categoryId: products.categoryId,
      offerId: offers.id,
      shopName: shops.name,
      priceCents: offers.priceCents,
      priceUpdatedAt: offers.priceUpdatedAt,
      isDemo: feeds.isDemo,
      indexable: sql<boolean>`${indexableProductWhere()}`,
      // Aliased to non-attr keys: only the importer may write an attr key (D13).
      viscosity: products.attrViscosity,
      volumeMl: products.attrVolumeMl,
      acea: products.attrAcea,
      oilType: products.attrOilType,
      approvals: products.attrApprovals,
    })
    .from(offers)
    .innerJoin(products, eq(offers.productId, products.id))
    .innerJoin(feeds, eq(offers.feedId, feeds.id))
    .innerJoin(shops, eq(feeds.shopId, shops.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.slug, slug), visibleProductWhere(), visibleOfferWhere()))
    .orderBy(asc(offers.priceCents), asc(shops.name), asc(offers.id));

  const first = rows[0];
  if (!first) return null;
  // The inner join and visibleProductWhere() guarantee a category; the guard narrows the type.
  if (first.categoryId === null) return null;
  const categoryTrail = await readCategoryTrail(first.categoryId);
  const flags = bestPriceFlags(rows.map((row) => row.priceCents));
  return {
    slug: first.slug,
    title: first.title,
    brand: nonBlank(first.brand),
    partNumber: nonBlank(first.partNumber),
    ean: nonBlank(first.ean),
    description: nonBlank(first.description),
    categorySlug: first.categorySlug,
    categoryTrail,
    offers: rows.map((row, i) => ({
      offerId: row.offerId,
      shopName: row.shopName,
      priceCents: row.priceCents,
      priceUpdatedAt: row.priceUpdatedAt,
      isBestPrice: flags[i],
    })),
    demoOnly: rows.every((row) => row.isDemo),
    indexable: first.indexable,
    attributes: pageAttributes(first.categorySlug, first),
  };
}
