import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories, feeds, offers, products, shops } from '../../db/schema';
import { isWellFormedSlug } from '../slug';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';
import { brandSlug, type CategorySort } from './category-query';
import { readCategoryTrail, type PublicCategoryCrumb } from './category-trail';
import { hasNonDemoOfferWhere } from './demo';

// The backend/frontend contract for the category page (C-3, S11.4). The page
// formats; this returns integer cents, never a formatted amount. Every product
// it lists, and every brand it counts, is public by the one visibility scope,
// the same one the product page uses.

export const CATEGORY_PAGE_SIZE = 24;

export type CategoryProductCard = {
  /** products.slug; link target /producto/<slug>. */
  slug: string;
  /** Never empty. */
  title: string;
  /** As received; null means render no brand line. */
  brand: string | null;
  /**
   * min(visible offers.price_cents). Integer > 0, EUR, IVA included. Equals
   * getPublicProductBySlug(slug).offers[0].priceCents for the same data.
   */
  lowestPriceCents: number;
  /**
   * count(visible offers). Integer >= 1. The same number the product page
   * shows as offers.length.
   */
  offerCount: number;
  /** categories.slug of the product's own category; never null for a public product. */
  categorySlug: string;
  /** products.part_number as received, trimmed; null when null or blank. */
  partNumber: string | null;
};

export type CategoryBrand = {
  /** brandSlug(...); matches /^[a-z0-9]+(-[a-z0-9]+)*$/, 1..64 chars, unique in the list. */
  slug: string;
  /** Display text, never empty. */
  label: string;
  /** Public products of this brand in the subtree, integer >= 1. */
  productCount: number;
};

/**
 * empty-category: the whole subtree holds no public product.
 * no-match: it holds some, and the listed set (after the brand filter) is empty.
 * results: otherwise.
 */
export type CategoryListingState = 'results' | 'no-match' | 'empty-category';

export type PublicCategoryPage = {
  /** categories.slug */
  slug: string;
  /** categories.name */
  name: string;
  /**
   * The category's ancestors, root first, the category itself excluded.
   * [] for a root category. Each links with categoryPath(slug) (page 1, no filter).
   */
  ancestors: PublicCategoryCrumb[];
  /** 1-based, the page returned. */
  page: number;
  /** >= 1; ceil(productCount / CATEGORY_PAGE_SIZE), exactly 1 when productCount is 0. */
  pageCount: number;
  /**
   * Public products in the listed set: the category and every descendant,
   * narrowed to the selected brand when there is one.
   */
  productCount: number;
  /** Public products in the whole subtree, whatever the brand. */
  categoryProductCount: number;
  state: CategoryListingState;
  /** Length 0..CATEGORY_PAGE_SIZE; 0 only when state is not 'results'. */
  products: CategoryProductCard[];
  /**
   * The brands of the whole subtree, independent of the selected brand and the
   * sort: productCount desc, then label, then slug. Empty for an empty category.
   */
  brands: CategoryBrand[];
  /** The entry of `brands` whose slug is the brand argument; null if none or unknown. */
  selectedBrand: CategoryBrand | null;
  /** The sort applied. */
  sort: CategorySort;
  /**
   * True when products.length >= 1 and every visible offer behind the listed
   * cards is from a demo feed. False when nothing is listed.
   */
  demoOnly: boolean;
  /**
   * True when the category subtree holds at least one public product with an
   * offer from a non-demo feed, whatever the brand. The same for every page
   * and every brand of the category. False means noindex.
   */
  indexable: boolean;
};

/**
 * `products.category_id` is in the category's subtree: the category and every
 * descendant at any depth. `UNION` (not `UNION ALL`) so a malformed parent
 * cycle terminates. The category id is a bound parameter.
 */
function inSubtree(categoryId: number): SQL {
  const subtree = sql`(
    with recursive subtree(id) as (
      select ${categoryId}::int
      union
      select child.id from ${categories} as child
      join subtree on child.parent_id = subtree.id
    )
    select id from subtree
  )`;
  return inArray(products.categoryId, subtree);
}

/** Locale-neutral label order: no language in code (D-8). */
function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, 'und', { sensitivity: 'base' });
}

type BrandGroup = { normalised: string; label: string | null; productCount: number };

/**
 * The brand list of the whole subtree from its per-brand_normalised groups.
 * Groups that share a slug merge into one chip with the counts summed; the
 * label is the one of the larger group, a tie going to the smaller label.
 * `values` maps a chip slug to the brand_normalised values behind it.
 */
function mergeBrands(groups: BrandGroup[]): {
  brands: CategoryBrand[];
  values: Map<string, string[]>;
} {
  type Merged = CategoryBrand & { labelGroupCount: number };
  const merged = new Map<string, Merged>();
  const values = new Map<string, string[]>();
  for (const group of groups) {
    const slug = brandSlug(group.normalised);
    if (slug === null) continue;
    const label = group.label?.trim() || group.normalised;
    const existing = merged.get(slug);
    if (existing === undefined) {
      merged.set(slug, {
        slug,
        label,
        productCount: group.productCount,
        labelGroupCount: group.productCount,
      });
      values.set(slug, [group.normalised]);
      continue;
    }
    existing.productCount += group.productCount;
    values.get(slug)?.push(group.normalised);
    if (
      group.productCount > existing.labelGroupCount ||
      (group.productCount === existing.labelGroupCount && compareLabels(label, existing.label) < 0)
    ) {
      existing.label = label;
      existing.labelGroupCount = group.productCount;
    }
  }
  const brands = [...merged.values()]
    .map(({ slug, label, productCount }) => ({ slug, label, productCount }))
    .sort(
      (a, b) =>
        b.productCount - a.productCount ||
        compareLabels(a.label, b.label) ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
  return { brands, values };
}

/**
 * One page of the public products of a category, or `null` for: a malformed
 * slug (rejected before any query), an unknown slug, or a page past the last
 * (of the listed set, so after the brand filter). `page` is an integer >= 1
 * (see parsePageParam); it is not clamped here. `brand` is a brand slug or
 * null (see parseBrandParam); one that names no brand of the category lists
 * nothing.
 *
 * Positional primitive arguments on purpose: React cache() memoises by
 * argument identity, so the page and generateMetadata share one read.
 */
export async function getPublicCategoryPage(
  slug: string,
  page: number,
  brand: string | null,
  sort: CategorySort,
): Promise<PublicCategoryPage | null> {
  if (!isWellFormedSlug(slug)) return null;
  const db = getDb();

  const [category] = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  if (!category) return null;

  const [[counted], [indexed], brandGroups, trail] = await Promise.all([
    db
      .select({ productCount: sql<number>`count(*)::int` })
      .from(products)
      .where(and(visibleProductWhere(), inSubtree(category.id))),
    db
      .select({ indexedCount: sql<number>`count(*)::int` })
      .from(products)
      .where(and(visibleProductWhere(), hasNonDemoOfferWhere(), inSubtree(category.id))),
    db
      .select({
        normalised: sql<string>`${products.brandNormalised}`,
        label: sql<string | null>`mode() within group (order by ${products.brand})`,
        productCount: sql<number>`count(*)::int`,
      })
      .from(products)
      .where(
        and(visibleProductWhere(), inSubtree(category.id), isNotNull(products.brandNormalised)),
      )
      .groupBy(products.brandNormalised),
    readCategoryTrail(category.id),
  ]);
  const categoryProductCount = counted?.productCount ?? 0;
  const indexable = (indexed?.indexedCount ?? 0) > 0;
  const { brands, values } = mergeBrands(brandGroups);
  const selectedBrand =
    brand === null ? null : (brands.find((entry) => entry.slug === brand) ?? null);

  // A brand argument that names no chip lists nothing; a chip narrows the set
  // to the brand_normalised values behind it.
  const brandValues = selectedBrand === null ? [] : (values.get(selectedBrand.slug) ?? []);
  const brandWhere: SQL | undefined =
    brand === null ? undefined : inArray(products.brandNormalised, brandValues);

  let productCount = categoryProductCount;
  if (brand !== null) {
    if (brandValues.length === 0) {
      productCount = 0;
    } else {
      const [filtered] = await db
        .select({ productCount: sql<number>`count(*)::int` })
        .from(products)
        .where(and(visibleProductWhere(), inSubtree(category.id), brandWhere));
      productCount = filtered?.productCount ?? 0;
    }
  }
  const pageCount = Math.max(1, Math.ceil(productCount / CATEGORY_PAGE_SIZE));
  if (page > pageCount) return null;

  const lowestPrice = sql<number>`min(${offers.priceCents})::int`;
  // Every order ends on products.id, so pages never repeat or skip a product.
  // Name order is the ICU root collation: no language, accents and case ignored
  // at the primary level (D-8, D-11).
  const order =
    sort === 'price-desc'
      ? [desc(lowestPrice), asc(products.id)]
      : sort === 'name'
        ? [sql`${products.title} collate "und-x-icu" asc`, asc(products.id)]
        : [asc(lowestPrice), asc(products.id)];
  const rows =
    productCount === 0
      ? []
      : await db
          .select({
            slug: products.slug,
            title: products.title,
            brand: products.brand,
            partNumber: products.partNumber,
            lowestPriceCents: lowestPrice,
            offerCount: sql<number>`count(*)::int`,
            categorySlug: categories.slug,
            allDemo: sql<boolean>`bool_and(${feeds.isDemo})`,
          })
          .from(offers)
          .innerJoin(products, eq(offers.productId, products.id))
          .innerJoin(feeds, eq(offers.feedId, feeds.id))
          .innerJoin(shops, eq(feeds.shopId, shops.id))
          .innerJoin(categories, eq(products.categoryId, categories.id))
          .where(
            and(visibleProductWhere(), visibleOfferWhere(), inSubtree(category.id), brandWhere),
          )
          .groupBy(products.id, categories.id)
          .orderBy(...order)
          .limit(CATEGORY_PAGE_SIZE)
          .offset((page - 1) * CATEGORY_PAGE_SIZE);

  const state: CategoryListingState =
    categoryProductCount === 0 ? 'empty-category' : productCount === 0 ? 'no-match' : 'results';

  return {
    slug: category.slug,
    name: category.name,
    ancestors: trail.slice(0, -1),
    page,
    pageCount,
    productCount,
    categoryProductCount,
    state,
    products: rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      brand: row.brand,
      lowestPriceCents: row.lowestPriceCents,
      offerCount: row.offerCount,
      categorySlug: row.categorySlug,
      partNumber: row.partNumber?.trim() || null,
    })),
    brands,
    selectedBrand,
    sort,
    demoOnly: rows.length > 0 && rows.every((row) => row.allDemo),
    indexable,
  };
}
