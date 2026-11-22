import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, products } from '@/db/schema';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';

import {
  allOffers,
  allProducts,
  insertFeed,
  insertFixtureFeed,
  insertProduct,
  insertShop,
} from '../support/catalogue';
import { ABSENT_VIEW, PUBLIC_VIEW, fiveTargets, publicView } from '../support/categories';
import { resetDatabase } from '../support/db';
import { fixtureDeps } from '../support/feeds';
import { EAN, MAPPED, OWN_PRODUCT_CASES, PLANTED, aFeedOf, importRows, keyRow, mapFeed, storedProduct } from '../support/matching';
import { stubNetworkOff } from '../support/network-off';

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

const run = (feedId?: number) => importFeeds(getDb(), { feedId, deps: fixtureDeps });

// 0008 step 1 (EAN), step 2 (brand + part number), new product; a conflict or ambiguity becomes an own product with a reason in the report (S7.1).
describe('EAN matching (0008, S7.1)', () => {
  it('attaches a second feed\'s row with the same EAN: one product, two offers, text unchanged', async () => {
    const first = await insertFixtureFeed('ean-first.csv', { shopName: 'Tienda A' });
    await run(first.feedId);
    const before = await allProducts();
    expect(before).toHaveLength(2);

    const second = await insertFixtureFeed('ean-second.csv', { shopName: 'Tienda B' });
    const report = await run(second.feedId);

    const after = await allProducts();
    expect(after).toEqual(before); // no new product, no text rewritten
    const alpha = after.find((row) => row.title === 'Fixture Alpha Filtro');
    expect(alpha).toMatchObject({ brand: 'MarcaUno', partNumber: 'PN 100', description: 'Descripcion alpha' });

    const offers = (await allOffers()).filter((offer) => offer.productId === alpha?.id);
    expect(offers.map((offer) => [offer.feedId, offer.priceCents]).sort()).toEqual(
      [
        [first.feedId, 1000],
        [second.feedId, 950],
      ].sort(),
    );
    expect(report.feeds[0]).toMatchObject({
      outcome: 'imported',
      rows: 2,
      productsCreated: 0,
      offersCreated: 2,
      rejected: [],
    });
  });

  it('matches an EAN written with hyphens against the stored digit string', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await run(first.feedId);
    const second = await insertFixtureFeed('ean-second.csv'); // B-1 writes 200-0000-000046
    await run(second.feedId);
    const [alpha] = await getDb().select().from(products).where(eq(products.eanNormalised, '2000000000046'));
    expect(alpha.ean).toBe('2000000000046'); // as received from the first feed
    expect((await allOffers()).filter((offer) => offer.productId === alpha.id)).toHaveLength(2);
  });

  it('treats brands that differ only in case and spacing as the same brand', async () => {
    // ean-second.csv B-1 has brand "marcauno " against the stored "MarcaUno".
    const first = await insertFixtureFeed('ean-first.csv');
    const second = await insertFixtureFeed('ean-second.csv');
    await run(first.feedId);
    const report = await run(second.feedId);
    expect(report.feeds[0].rejected).toEqual([]);
  });

  it('makes the same EAN with a different brand its own product, reported as ean_brand_conflict', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await run(first.feedId);
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();

    const conflict = await insertFixtureFeed('ean-brand-conflict.csv');
    const report = await run(conflict.feedId);

    expect(report.feeds[0]).toMatchObject({
      outcome: 'imported',
      rows: 1,
      productsCreated: 1,
      offersCreated: 1,
      rejected: [],
      ownProducts: [{ record: 2, reason: 'ean_brand_conflict' }],
    });
    const productsAfter = await allProducts();
    expect(productsAfter).toHaveLength(productsBefore.length + 1);
    expect(productsAfter.slice(0, productsBefore.length)).toEqual(productsBefore);
    const offersAfter = await allOffers();
    expect(offersAfter).toHaveLength(offersBefore.length + 1);
    expect(offersAfter.slice(0, offersBefore.length)).toEqual(offersBefore);
  });

  it('attaches when the incoming row has no brand', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await run(first.feedId);
    const nullBrand = await insertFixtureFeed('ean-null-brand.csv');
    const report = await run(nullBrand.feedId);

    expect(report.feeds[0].rejected).toEqual([]);
    const [alpha] = await getDb().select().from(products).where(eq(products.eanNormalised, '2000000000046'));
    expect((await allOffers()).filter((offer) => offer.productId === alpha.id)).toHaveLength(2);
  });

  it('attaches when the stored product has no brand', async () => {
    const stored = await insertProduct({
      slug: 'sin-marca',
      title: 'Producto sin marca',
      ean: '2000000000060',
      eanNormalised: '2000000000060',
      brand: null,
      brandNormalised: null,
    });
    const feed = await insertFixtureFeed('ean-null-brand.csv'); // D-2: EAN ...060 with brand MarcaDos
    const report = await run(feed.feedId);

    expect(report.feeds[0].rejected).toEqual([]);
    const attached = (await allOffers()).filter((offer) => offer.productId === stored.id);
    expect(attached.map((offer) => offer.externalId)).toEqual(['D-2']);
  });

  it('creates a new product for a row whose EAN nobody has', async () => {
    const feed = await insertFixtureFeed('ean-first.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0]).toMatchObject({ productsCreated: 2, offersCreated: 2 });
    expect(await allProducts()).toHaveLength(2);
  });

  it('makes a row its own product, reported as ambiguous_ean, when two products already share the EAN', async () => {
    await insertProduct({ slug: 'gemelo-1', ean: '2000000000046', eanNormalised: '2000000000046' });
    await insertProduct({ slug: 'gemelo-2', ean: '2000000000046', eanNormalised: '2000000000046' });
    const feed = await insertFixtureFeed('ean-null-brand.csv');
    const report = await run(feed.feedId);

    expect(report.feeds[0].rejected).toEqual([]);
    expect(report.feeds[0].ownProducts).toEqual([{ record: 2, reason: 'ambiguous_ean' }]);
    expect(await allProducts()).toHaveLength(4); // the two twins plus one product each for D-1 and D-2
    expect((await allOffers()).map((offer) => offer.externalId).sort()).toEqual(['D-1', 'D-2']);
  });

  it('converges two rows without an EAN that share brand and part number: one product, two offers', async () => {
    const feed = await insertFixtureFeed('no-ean.csv');
    const report = await run(feed.feedId);

    expect(report.feeds[0]).toMatchObject({
      productsCreated: 1,
      offersCreated: 2,
      rejected: [],
      ownProducts: [],
    });
    const rows = await allProducts();
    expect(rows).toHaveLength(1);
    expect(rows[0].ean).toBeNull();
    expect(await allOffers()).toHaveLength(2);
  });

  it('gives each row without an EAN its own product, with numbered slugs on a title clash', async () => {
    const feed = await insertFixtureFeed('no-ean-title-clash.csv');
    const report = await run(feed.feedId);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 2, offersCreated: 2, rejected: [] });
    const rows = await allProducts();
    expect(rows.map((row) => row.slug).sort()).toEqual(['producto-sin-ean', 'producto-sin-ean-2']);
    expect(rows.every((row) => row.ean === null && row.eanNormalised === null)).toBe(true);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it('keeps part number and brand stored raw and normalised side by side', async () => {
    const feed = await insertFixtureFeed('ean-first.csv');
    await run(feed.feedId);
    const [alpha] = await getDb().select().from(products).where(eq(products.slug, 'fixture-alpha-filtro'));
    expect(alpha).toMatchObject({
      brand: 'MarcaUno',
      brandNormalised: 'MARCAUNO',
      partNumber: 'PN 100',
      partNumberNormalised: 'PN100',
    });
  });
});

describe('row rules that decide which product a row belongs to', () => {
  it('rejects a present but invalid EAN as invalid_ean instead of creating a stray product', async () => {
    const feed = await insertFixtureFeed('rejects.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0].rejected).toContainEqual({ record: 7, code: 'invalid_ean', field: 'ean' });
    expect((await allOffers()).map((offer) => offer.externalId)).not.toContain('R-6');
  });

  it('rejects the second row that repeats an id within one feed as duplicate_id', async () => {
    const feed = await insertFixtureFeed('rejects.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0].rejected).toContainEqual({ record: 9, code: 'duplicate_id', field: 'id' });
    const kept = (await allOffers()).filter((offer) => offer.externalId === 'R-1');
    expect(kept).toHaveLength(1);
    expect(kept[0].priceCents).toBe(500); // the first occurrence wins
  });

  it('reports every reject code of a mixed feed with its record number and keeps the good row', async () => {
    const feed = await insertFixtureFeed('rejects.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rows: 8, offersCreated: 1 });
    expect(report.feeds[0].rejected).toEqual([
      { record: 3, code: 'missing_id', field: 'id' },
      { record: 4, code: 'missing_title', field: 'title' },
      { record: 5, code: 'invalid_price', field: 'price' },
      { record: 6, code: 'invalid_currency', field: 'currency' },
      { record: 7, code: 'invalid_ean', field: 'ean' },
      { record: 8, code: 'invalid_url', field: 'url' },
      { record: 9, code: 'duplicate_id', field: 'id' },
    ]);
  });

  it('stores the prices of price-edge.csv as exact integer cents', async () => {
    const feed = await insertFixtureFeed('price-edge.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0]).toMatchObject({ rows: 7, offersCreated: 7, rejected: [] });
    const cents = Object.fromEntries((await allOffers()).map((offer) => [offer.externalId, offer.priceCents]));
    expect(cents).toEqual({
      'P-1': 1999,
      'P-2': 29,
      'P-3': 110,
      'P-4': 1200,
      'P-5': 1250,
      'P-6': 435,
      'P-7': 999999999,
    });
  });
});

describe('a known offer is updated, never re-matched (TD-23, TD-24)', () => {
  it('updates price and url on a second import and leaves the product text alone', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id, { url: 'ean-first.csv' });
    await run(feedId);
    const before = await allProducts();

    // The same shop's feed now serves different text and prices for the same ids.
    await getDb().update(feeds).set({ url: 'changed-text.csv' }).where(eq(feeds.id, feedId));
    const report = await run(feedId);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1 });
    expect(await allProducts()).toEqual(before);
    const updated = (await allOffers()).find((offer) => offer.externalId === 'A-1');
    expect(updated).toMatchObject({ priceCents: 1125, url: 'https://shop-a.example/p/A-1-new' });
  });
});

describe('a hidden product still receives offers', () => {
  it('attaches the new offer to the hidden product and keeps it hidden', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await run(first.feedId);
    await getDb().update(products).set({ isHidden: true }).where(eq(products.slug, 'fixture-alpha-filtro'));

    const second = await insertFixtureFeed('ean-second.csv');
    await run(second.feedId);

    const [alpha] = await getDb().select().from(products).where(eq(products.slug, 'fixture-alpha-filtro'));
    expect(alpha.isHidden).toBe(true);
    expect((await allOffers()).filter((offer) => offer.productId === alpha.id)).toHaveLength(2);
    expect(await allProducts()).toHaveLength(2);
  });
});

// S7.1 (T7.1.2) additions. The EAN-first rules of AC 13 re-run under the new matcher, and the four
// ways a row becomes its own product (ACs 15, 16, 19, 20): the output line (AC 17), the product it
// leaves (AC 18) and what the lookup does not touch. ACs 1 to 12, 14, 15 and 20 to 24 are in
// importer-brand-part-number.test.ts.
describe('the EAN rules hold with step 2 behind them (AC 13)', () => {
  it('rejects a present but invalid EAN as invalid_ean before matching, even when brand and part number match a product', async () => {
    const holder = await storedProduct({ slug: 'titular', brand: 'MarcaUno', part: 'PN 100' });
    const feed = await aFeedOf();

    const report = await importRows({ [feed.feedId]: [keyRow('x-1', { brand: 'MarcaUno', part: 'PN 100', ean: '2000000000016' })] });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, ownProducts: [] });
    expect(report.feeds[0].rejected).toEqual([{ record: 2, code: 'invalid_ean', field: 'ean' }]);
    expect((await allOffers()).filter((offer) => offer.productId === holder.id)).toEqual([]);
  });

  it('attaches by EAN when the incoming brand is missing, whatever the key says', async () => {
    const holder = await storedProduct({ slug: 'titular', brand: 'MarcaUno', part: 'PN 100', ean: EAN.one });
    await storedProduct({ slug: 'otro', brand: 'MarcaDos', part: 'PN 200' });
    const feed = await aFeedOf();

    const report = await importRows({ [feed.feedId]: [keyRow('x-1', { part: 'PN 200', ean: EAN.one })] });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, rejected: [], ownProducts: [] });
    expect((await allOffers()).map((offer) => offer.productId)).toEqual([holder.id]);
  });

  it('matches an EAN written with spaces and hyphens against the stored digit string', async () => {
    const holder = await storedProduct({ slug: 'titular', brand: 'MarcaUno', part: 'PN 100', ean: EAN.one });
    const feed = await aFeedOf();

    await importRows({ [feed.feedId]: [keyRow('x-1', { brand: 'MarcaUno', part: 'PN 999', ean: '200 0000-000046' })] });

    expect((await allOffers()).map((offer) => offer.productId)).toEqual([holder.id]);
  });
});

describe.each(OWN_PRODUCT_CASES)('a row that becomes its own product: $reason (AC $ac)', ({ reason, seed, row }) => {
  it('is stored as a product and an offer, listed once in the output with only its record number and reason', async () => {
    await seed();
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();
    const feed = await aFeedOf('Tienda Conflicto');

    const report = await importRows({ [feed.feedId]: [row()] });
    const text = formatImportReport(report);

    expect(report.feeds[0]).toMatchObject({
      outcome: 'imported',
      rows: 1,
      productsCreated: 1,
      offersCreated: 1,
      rejected: [],
      ownProducts: [{ record: 2, reason }],
    });
    expect(text.split('\n')).toEqual([
      `feed ${feed.feedId} "Tienda Conflicto": imported rows=1 products_created=1 offers_created=1 offers_updated=0 rejected=0 unknown_vehicles=0`,
      `  record 2: own_product ${reason}`,
      'total: feeds=1 imported=1 skipped=0 failed=0',
    ]);
    // Nothing the file says reaches the line: no brand, part number, title, EAN, id or link.
    for (const planted of [PLANTED.brand, PLANTED.brandNormalised, PLANTED.part, PLANTED.partNormalised, PLANTED.title, PLANTED.url, 'planted-shop', EAN.one, EAN.two, 'own-1']) {
      expect(text).not.toContain(planted);
    }
    expect(importExitCode(report)).toBe(0);
    // No existing product or offer changed; one product and one offer were added.
    const productsAfter = await allProducts();
    const offersAfter = await allOffers();
    expect(productsAfter.slice(0, productsBefore.length)).toEqual(productsBefore);
    expect(offersAfter.slice(0, offersBefore.length)).toEqual(offersBefore);
    expect(productsAfter).toHaveLength(productsBefore.length + 1);
    expect(offersAfter).toHaveLength(offersBefore.length + 1);
  });

  it('is an ordinary product: no hidden flag, no review flag, the row\'s own text and offer', async () => {
    await seed();
    const feed = await aFeedOf();

    await importRows({ [feed.feedId]: [row()] });

    const own = (await allProducts()).find((product) => product.title === PLANTED.title);
    expect(own).toMatchObject({ isHidden: false, categoryId: null, brand: PLANTED.brand, partNumber: PLANTED.part });
    const offer = (await allOffers()).find((entry) => entry.externalId === 'own-1');
    expect(offer).toMatchObject({ productId: own?.id, isHidden: false, inReview: false, priceCents: 1000 });
  });

  it('is public under the usual rule and not otherwise: mapped and approved shows it, unmapped or unapproved does not', async () => {
    await seed();
    const feed = await aFeedOf();
    const target = await mapFeed(feed.feedId);
    await importRows({ [feed.feedId]: [row({ category: MAPPED })] });
    const own = (await allProducts()).find((product) => product.title === PLANTED.title)!;
    const offer = (await allOffers()).find((entry) => entry.externalId === 'own-1')!;
    const view = { productSlug: own.slug, offerId: offer.id, categorySlug: target.slug };

    expect(await publicView(view)).toEqual(PUBLIC_VIEW);

    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, feed.feedId));
    expect(await publicView(view)).toEqual(ABSENT_VIEW);
  });

  it('is not public when its feed category is not mapped, however it was matched', async () => {
    await seed();
    const feed = await aFeedOf(); // no mapping for MAPPED
    const [target] = await fiveTargets();
    await importRows({ [feed.feedId]: [row({ category: MAPPED })] });
    const own = (await allProducts()).find((product) => product.title === PLANTED.title)!;
    const offer = (await allOffers()).find((entry) => entry.externalId === 'own-1')!;

    expect(await publicView({ productSlug: own.slug, offerId: offer.id, categorySlug: target.slug })).toEqual(ABSENT_VIEW);
  });

  it('is named once and not listed again by the next import, which changes only the price (AC 21)', async () => {
    await seed();
    const feed = await aFeedOf();
    await importRows({ [feed.feedId]: [row()] });
    const productsBefore = await allProducts();

    const report = await importRows({ [feed.feedId]: [{ ...row(), price: '12.34' }] });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1, rejected: [], ownProducts: [] });
    expect(formatImportReport(report)).not.toContain('own_product');
    expect(await allProducts()).toEqual(productsBefore);
    expect((await allOffers()).find((entry) => entry.externalId === 'own-1')?.priceCents).toBe(1234);
  });
});

describe('a conflict or an ambiguity on the EAN never reaches the key step (AC 16, 19)', () => {
  it('AC 16: an EAN held by another brand makes the row its own product even when its key is held by a third product', async () => {
    await storedProduct({ slug: 'titular-ean', brand: 'MarcaUno', part: 'PN 100', ean: EAN.one });
    const keyHolder = await storedProduct({ slug: 'titular-clave', brand: 'MarcaDos', part: 'PN 200' });
    const feed = await aFeedOf();

    const report = await importRows({ [feed.feedId]: [keyRow('x-1', { brand: 'MarcaDos', part: 'PN 200', ean: EAN.one })] });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 1, ownProducts: [{ record: 2, reason: 'ean_brand_conflict' }] });
    expect((await allOffers()).some((offer) => offer.productId === keyHolder.id)).toBe(false);
  });

  it('AC 19: an EAN held by two products makes the row its own product even when its key is held by a third', async () => {
    await storedProduct({ slug: 'gemelo-1', ean: EAN.one });
    await storedProduct({ slug: 'gemelo-2', ean: EAN.one });
    const keyHolder = await storedProduct({ slug: 'titular-clave', brand: 'MarcaDos', part: 'PN 200' });
    const feed = await aFeedOf();

    const report = await importRows({ [feed.feedId]: [keyRow('x-1', { brand: 'MarcaDos', part: 'PN 200', ean: EAN.one })] });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 1, ownProducts: [{ record: 2, reason: 'ambiguous_ean' }] });
    expect((await allOffers()).some((offer) => offer.productId === keyHolder.id)).toBe(false);
  });

  it('AC 16: the output names every such row of a feed by record number, in record order', async () => {
    await storedProduct({ slug: 'titular-ean', brand: 'MarcaUno', part: 'PN 100', ean: EAN.one });
    await storedProduct({ slug: 'gemelo-1', ean: EAN.two });
    await storedProduct({ slug: 'gemelo-2', ean: EAN.two });
    const feed = await aFeedOf();

    const report = await importRows({
      [feed.feedId]: [
        keyRow('x-1', { brand: 'MarcaOtra', ean: EAN.one }),
        keyRow('x-2'),
        keyRow('x-3', { ean: EAN.two }),
      ],
    });

    expect(report.feeds[0].ownProducts).toEqual([
      { record: 2, reason: 'ean_brand_conflict' },
      { record: 4, reason: 'ambiguous_ean' },
    ]);
    expect(formatImportReport(report)).toContain('  record 2: own_product ean_brand_conflict\n  record 4: own_product ambiguous_ean');
  });
});
