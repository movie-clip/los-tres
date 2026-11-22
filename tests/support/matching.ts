import { getDb } from '@/db/client';
import { importFeeds } from '@/server/importer';
import { normalizeBrand, normalizePartNumber, type OwnProductReason } from '@/server/matching';

import { insertCategoryMapping, insertFeed, insertProduct, insertShop } from './catalogue';
import { catalogueCsv, type CatalogueRow } from './catalogue-files';
import { fiveTargets } from './categories';
import { textDeps } from './feeds';

// Support for the S7.1 matching tests (US-7.1, T7.1.2). Feed rows are written with `catalogueCsv`
// (the one helper that carries `part_number`) and served through `textDeps`, so a test names its
// rows in the test and no fixture file is needed for a pair. Every shop, product and link is invented.

/** Valid EAN-13 values (GS1 check digit correct) none of the older fixtures needs together. */
export const EAN = {
  one: '2000000000046',
  two: '2000000000053',
  three: '2000000000060',
  four: '2000000000077',
  five: '2000000000084',
} as const;

/** Text no output line may repeat: the brand, part number, title and link of a planted row (AC 17). */
export const PLANTED = {
  brand: 'PlantedBrand',
  brandNormalised: 'PLANTEDBRAND',
  part: 'PLANTED-PN 77',
  partNormalised: 'PLANTEDPN77',
  title: 'Planted Title Xyzzy',
  url: 'https://planted-shop.example/p/xyzzy',
} as const;

/** The feed category string every mapped test row carries; `mapFeed` maps it. */
export const MAPPED = 'Filtros de prueba';

/** One feed row. Defaults: EUR, a price, a link built from the id, a title built from the id. */
export function keyRow(
  id: string,
  o: { brand?: string; part?: string; ean?: string; price?: string; title?: string; url?: string; category?: string } = {},
): CatalogueRow {
  return {
    id,
    title: o.title ?? `Producto ${id}`,
    price: o.price ?? '10.00',
    url: o.url ?? `https://tienda-${id}.example/p/${id}`,
    brand: o.brand ?? '',
    part_number: o.part ?? '',
    ean: o.ean ?? '',
    currency: 'EUR',
    category: o.category ?? '',
  };
}

/** A shop and an approved feed; the feed's url is never read (`importRows` serves the text). */
export async function aFeedOf(
  shopName?: string,
  o: { feedApproved?: boolean; shopApproved?: boolean } = {},
): Promise<{ shopId: number; shopName: string; feedId: number }> {
  const shop = await insertShop({ name: shopName, isApproved: o.shopApproved });
  const feedId = await insertFeed(shop.id, { isApproved: o.feedApproved });
  return { shopId: shop.id, shopName: shop.name, feedId };
}

/** Maps `MAPPED` of the feed to the first fixed category, so what it imports can be public. Returns that category. */
export async function mapFeed(feedId: number) {
  const [target] = await fiveTargets();
  await insertCategoryMapping(feedId, MAPPED, target.id);
  return target;
}

/**
 * Imports the text of each feed in one run (feeds run in id order), or one feed with `feedId`.
 * A feed with no entry in `byFeed` is not read, so pass `feedId` when other feeds exist.
 * Use it for a column `catalogueCsv` does not write (a description).
 */
export function importText(byFeed: Record<number, string>, o: { feedId?: number } = {}) {
  return importFeeds(getDb(), {
    ...(o.feedId === undefined ? {} : { feedId: o.feedId }),
    deps: textDeps(byFeed),
  });
}

/** `importText` over rows written with `catalogueCsv`. */
export function importRows(byFeed: Record<number, CatalogueRow[]>, o: { feedId?: number } = {}) {
  const served: Record<number, string> = {};
  for (const [feedId, rows] of Object.entries(byFeed)) served[Number(feedId)] = catalogueCsv(rows);
  return importText(served, o);
}

/**
 * A product inserted by hand, the way the importer would have stored it: the normalised columns
 * are filled with the real normalisers unless the test passes them in `extra` (a stale or empty
 * value, AC 9). Public by default (mapped to the shared test category), no offer.
 */
export async function storedProduct(o: {
  slug: string;
  brand?: string | null;
  part?: string | null;
  ean?: string | null;
  extra?: Parameters<typeof insertProduct>[0];
}) {
  const brand = o.brand ?? null;
  const part = o.part ?? null;
  const ean = o.ean ?? null;
  return insertProduct({
    slug: o.slug,
    brand,
    brandNormalised: normalizeBrand(brand),
    partNumber: part,
    partNumberNormalised: normalizePartNumber(part),
    ean,
    eanNormalised: ean,
    ...o.extra,
  });
}

/**
 * The four ways a row becomes its own product (ACs 15, 16, 19, 20), each as the stored products
 * that cause it and the row to import. The row carries the planted text. Call `seed()` after a
 * reset, then import `row` through `importRows`.
 */
export type OwnProductCase = {
  reason: OwnProductReason;
  ac: number;
  seed: () => Promise<void>;
  row: (o?: { category?: string }) => CatalogueRow;
};

export const OWN_PRODUCT_CASES: OwnProductCase[] = [
  {
    reason: 'ean_brand_conflict',
    ac: 16,
    seed: async () => {
      await storedProduct({ slug: 'titular-del-ean', brand: 'MarcaUno', part: 'PN 100', ean: EAN.one });
    },
    row: (o) =>
      keyRow('own-1', {
        brand: PLANTED.brand,
        part: PLANTED.part,
        ean: EAN.one,
        title: PLANTED.title,
        url: PLANTED.url,
        category: o?.category,
      }),
  },
  {
    reason: 'ambiguous_ean',
    ac: 19,
    seed: async () => {
      await storedProduct({ slug: 'gemelo-ean-1', ean: EAN.one });
      await storedProduct({ slug: 'gemelo-ean-2', ean: EAN.one });
    },
    row: (o) =>
      keyRow('own-1', {
        brand: PLANTED.brand,
        part: PLANTED.part,
        ean: EAN.one,
        title: PLANTED.title,
        url: PLANTED.url,
        category: o?.category,
      }),
  },
  {
    reason: 'brand_part_number_ean_conflict',
    ac: 15,
    seed: async () => {
      await storedProduct({ slug: 'titular-de-la-clave', brand: PLANTED.brand, part: PLANTED.part, ean: EAN.two });
    },
    row: (o) =>
      keyRow('own-1', {
        brand: PLANTED.brand,
        part: PLANTED.part,
        ean: EAN.one,
        title: PLANTED.title,
        url: PLANTED.url,
        category: o?.category,
      }),
  },
  {
    reason: 'ambiguous_brand_part_number',
    ac: 20,
    seed: async () => {
      await storedProduct({ slug: 'gemelo-clave-1', brand: PLANTED.brand, part: PLANTED.part });
      await storedProduct({ slug: 'gemelo-clave-2', brand: PLANTED.brand, part: PLANTED.part });
    },
    row: (o) =>
      keyRow('own-1', {
        brand: PLANTED.brand,
        part: PLANTED.part,
        title: PLANTED.title,
        url: PLANTED.url,
        category: o?.category,
      }),
  },
];
