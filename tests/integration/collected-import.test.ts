import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, fitments, offers } from '@/db/schema';
import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';
import { assignCategory, removeCategoryMapping } from '@/server/admin/category-mappings';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { readProductFitState, readProductVehicles } from '@/server/catalogue/fit-state';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { formatImportReport } from '@/server/importer';

import {
  allOffers,
  allProducts,
  insertFeed,
  insertShop,
  vehicleIdBySlug,
} from '../support/catalogue';
import { aFileFeed, catalogueCsv, importFromFolder, tempCatalogueFolder, type CatalogueRow } from '../support/catalogue-files';
import { categoryForm, fiveTargets, productIn, sitemapProducts } from '../support/categories';
import { resetDatabase } from '../support/db';
import { stubLocalFlag } from '../support/local-flag';
import {
  EAN,
  MAPPED,
  PLANTED,
  aFeedOf,
  importRows,
  keyRow,
  mapFeed,
  storedProduct,
} from '../support/matching';
import { stubNetworkOff } from '../support/network-off';

// A hang guard (0006, rule 4): the file runs real imports.
vi.setConfig({ testTimeout: 30_000 });

// S12.2 (decision 0017): what the importer does with a collected feed. The marker (ACs 12 and 14), the
// matching rule of D-4 (ACs 28 to 31), the fitment rule (AC 32) and the category guard of DS-9 (a marked
// row never sets or moves an unmarked product's category). The reader of the two folders is
// collected-source.test.ts. Every shop, product and file here is invented.

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

const [CAR] = VEHICLE_CATALOGUE;
const ROWS: CatalogueRow[] = [
  keyRow('a-1', { title: 'Filtro de aceite Prueba A', price: '10.50', brand: 'Marca', part: 'PA-1', ean: EAN.one }),
  keyRow('a-2', { title: 'Filtro de aire Prueba B', price: '7.25', brand: 'Marca', part: 'PA-2' }),
];

const collectedFeed = (name?: string) => aFeedOf(name, { sourceType: 'collected_file' });

/** The offers joined to the source kind of their feed: how a marked offer is read, never from a stored offer column. */
async function offerKinds(): Promise<{ id: number; feedId: number; kind: string }[]> {
  const rows = await getDb()
    .select({ id: offers.id, feedId: offers.feedId, kind: feeds.sourceType })
    .from(offers)
    .innerJoin(feeds, eq(feeds.id, offers.feedId))
    .orderBy(offers.id);
  return rows;
}

describe('the importer marks what comes from a collected feed (AC 12)', () => {
  it('marks every product and every offer of a first import read from the collected folder, and prints no row text', async () => {
    const collected = await tempCatalogueFolder();
    const catalogue = await tempCatalogueFolder();
    try {
      await writeFile(path.join(collected.dir, 'recopilado.csv'), catalogueCsv(ROWS));
      const { feedId } = await aFileFeed('recopilado.csv', { kind: 'collected_file' });

      const report = await importFromFolder(catalogue.dir, { feedId, collectedDir: collected.dir });

      expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rows: 2, productsCreated: 2, offersCreated: 2, rejected: [] });
      expect((await allProducts()).map((row) => row.isCollected)).toEqual([true, true]);
      expect((await offerKinds()).map((row) => row.kind)).toEqual(['collected_file', 'collected_file']);
      const text = formatImportReport(report);
      for (const row of ROWS) expect(text).not.toContain(row.title as string);
      expect(text).not.toMatch(/https?:|Prueba|Marca|\.csv/);
    } finally {
      await collected.remove();
      await catalogue.remove();
    }
  });

  it('keeps them marked on every re-import and changes nothing but the price and its date', async () => {
    const collected = await tempCatalogueFolder();
    const catalogue = await tempCatalogueFolder();
    try {
      const file = path.join(collected.dir, 'recopilado.csv');
      await writeFile(file, catalogueCsv(ROWS));
      const { feedId } = await aFileFeed('recopilado.csv', { kind: 'collected_file' });
      await importFromFolder(catalogue.dir, { feedId, collectedDir: collected.dir });
      const productsBefore = await allProducts();
      const offersBefore = await allOffers();

      await writeFile(file, catalogueCsv([{ ...ROWS[0], price: '9.99' }, ROWS[1]]));
      const again = await importFromFolder(catalogue.dir, { feedId, collectedDir: collected.dir });

      expect(again.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 0, offersCreated: 0, offersUpdated: 2 });
      expect(await allProducts()).toEqual(productsBefore);
      const offersAfter = await allOffers();
      expect(offersAfter.map((row) => row.priceCents)).toEqual([999, 725]);
      const strip = (row: (typeof offersBefore)[number]) => ({ ...row, priceCents: 0, priceUpdatedAt: new Date(0) });
      expect(offersAfter.map(strip)).toEqual(offersBefore.map(strip));
      expect((await allProducts()).every((row) => row.isCollected)).toBe(true);
    } finally {
      await collected.remove();
      await catalogue.remove();
    }
  });

  it('marks the offers of a collected feed that attach to an existing unmarked product, and leaves that product unmarked', async () => {
    const hand = await aFeedOf('Tienda escrita a mano');
    await importRows({ [hand.feedId]: [ROWS[0]] }, { feedId: hand.feedId });
    const collected = await collectedFeed();

    const report = await importRows({ [collected.feedId]: [{ ...ROWS[0], id: 'recopilado-1' }] }, { feedId: collected.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1 });
    expect((await allProducts()).map((row) => row.isCollected)).toEqual([false]);
    expect((await offerKinds()).map((row) => row.kind)).toEqual(['shop_upload', 'collected_file']);
  });
});

describe('a hand-written, affiliate or demo feed is never marked, and its import is as before (AC 14)', () => {
  it('marks no product of a catalogue-file, a shop-upload, an affiliate-shaped or a demo feed that imports the same rows', async () => {
    const catalogue = await tempCatalogueFolder();
    try {
      await writeFile(path.join(catalogue.dir, 'escrito.csv'), catalogueCsv(ROWS));
      const written = await aFileFeed('escrito.csv');
      const upload = await aFeedOf('Tienda de subida');
      const demoShop = await insertShop({ name: 'Tienda demo' });
      const demoFeed = await insertFeed(demoShop.id, { isDemo: true });
      const rowsOf = (suffix: string) => ROWS.map((row) => ({ ...row, id: `${row.id}-${suffix}`, ean: '', part_number: `${row.part_number}-${suffix}` }));

      await importFromFolder(catalogue.dir, { feedId: written.feedId });
      await importRows({ [upload.feedId]: rowsOf('up') }, { feedId: upload.feedId });
      await importRows({ [demoFeed]: rowsOf('demo') }, { feedId: demoFeed });

      const all = await allProducts();
      expect(all.length).toBeGreaterThanOrEqual(6);
      expect(all.every((row) => row.isCollected === false)).toBe(true);
      expect((await offerKinds()).map((row) => row.kind)).not.toContain('collected_file');
    } finally {
      await catalogue.remove();
    }
  });

  it('gives a collected feed the same report as a hand-written one over the same rows, apart from who it is', async () => {
    const written = await aFeedOf('Tienda escrita');
    const collected = await collectedFeed('Tienda recopilada');
    const rows = [ROWS[0], { ...ROWS[1], price: 'gratis' }];

    const one = (await importRows({ [written.feedId]: rows }, { feedId: written.feedId })).feeds[0];
    const two = (await importRows({ [collected.feedId]: rows.map((row) => ({ ...row, id: `c-${row.id}`, ean: '', part_number: 'OTRA-CLAVE' })) }, { feedId: collected.feedId })).feeds[0];

    const shape = (report: typeof one) => ({ ...report, feedId: 0, shopName: '' });
    // Same counts, same rejected row: a collected feed's report is the usual one, no field of its own.
    expect(shape(two)).toEqual(shape(one));
    expect(shape(one).rejected).toHaveLength(1);
  });
});

/**
 * Two feeds that name the same product: `key` is the part of the row the matcher keys on. The order of the
 * two imports is the variable of AC 28 and 29, so each describe runs both orders.
 */
const KEYS = [
  { name: 'EAN', key: { brand: 'Alfa', ean: EAN.one } },
  { name: 'brand and part number', key: { brand: 'Alfa', part: 'AB-100' } },
] as const;

describe.each(KEYS)('matching on $name (ACs 28 to 31, D-4)', ({ key }) => {
  const markedRow = (title: string) => keyRow('recopilado-1', { ...key, title, price: '5.00', category: MAPPED });
  const handRow = (title: string) => keyRow('mano-1', { ...key, title, price: '9.00', category: MAPPED });

  it('AC 28: an unmarked row never attaches to a marked product, so it becomes its own plain product (collected first)', async () => {
    const collected = await collectedFeed('Tienda recopilada');
    const hand = await aFeedOf('Tienda escrita a mano');
    await mapFeed(collected.feedId);
    await mapFeed(hand.feedId);
    await importRows({ [collected.feedId]: [markedRow('Titulo recopilado secreto')] }, { feedId: collected.feedId });
    const [marked] = await allProducts();
    const markedBefore = { ...marked };

    const report = await importRows({ [hand.feedId]: [handRow('Titulo escrito a mano')] }, { feedId: hand.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 1, offersCreated: 1, rejected: [], ownProducts: [] });
    const [first, second] = await allProducts();
    expect(first).toEqual(markedBefore);
    expect(second).toMatchObject({ title: 'Titulo escrito a mano', isCollected: false });
    expect((await allOffers()).map((offer) => [offer.productId, offer.feedId])).toEqual([
      [first.id, collected.feedId],
      [second.id, hand.feedId],
    ]);
  });

  it('AC 28: with the flag off the marked text appears on no public page, and the plain product is the one found (collected first)', async () => {
    stubLocalFlag('off');
    const collected = await collectedFeed();
    const hand = await aFeedOf();
    await mapFeed(collected.feedId);
    await mapFeed(hand.feedId);
    await importRows({ [collected.feedId]: [markedRow('Titulo recopilado secreto')] }, { feedId: collected.feedId });
    await importRows({ [hand.feedId]: [handRow('Titulo escrito a mano')] }, { feedId: hand.feedId });
    const [marked, plain] = await allProducts();

    expect(await getPublicProductBySlug(marked.slug)).toBeNull();
    const page = await getPublicProductBySlug(plain.slug);
    expect(page?.title).toBe('Titulo escrito a mano');
    expect(page?.offers.map((offer) => offer.priceCents)).toEqual([900]);
    expect(JSON.stringify(page)).not.toContain('secreto');
    expect(await getPublicSearchPage(parseSearchTerm('secreto'), 1)).toMatchObject({ state: 'no-results' });
    expect(await sitemapProducts()).toEqual([plain.slug]);
    const [target] = await fiveTargets();
    const listing = await getPublicCategoryPage(target.slug, 1, null, 'price-asc');
    expect(listing?.products.map((card) => card.slug)).toEqual([plain.slug]);
  });

  it('AC 28: the same holds when the plain product is re-imported afterwards (the update path)', async () => {
    const collected = await collectedFeed();
    const hand = await aFeedOf();
    await importRows({ [collected.feedId]: [markedRow('Titulo recopilado secreto')] }, { feedId: collected.feedId });
    await importRows({ [hand.feedId]: [handRow('Titulo escrito a mano')] }, { feedId: hand.feedId });
    const before = await allProducts();

    const again = await importRows({ [hand.feedId]: [handRow('Titulo escrito a mano')] }, { feedId: hand.feedId });

    expect(again.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1 });
    expect(await allProducts()).toEqual(before);
  });

  it('AC 29: a marked row attaches to an existing unmarked product as an offer, and the page with the flag off is the same before and after', async () => {
    stubLocalFlag('off');
    const hand = await aFeedOf('Tienda escrita a mano');
    const collected = await collectedFeed('Tienda recopilada');
    await mapFeed(hand.feedId);
    await mapFeed(collected.feedId);
    await importRows({ [hand.feedId]: [handRow('Titulo escrito a mano')] }, { feedId: hand.feedId });
    const [plain] = await allProducts();
    const pageBefore = await getPublicProductBySlug(plain.slug);
    const productsBefore = await allProducts();
    const [target] = await fiveTargets();
    const listingBefore = await getPublicCategoryPage(target.slug, 1, null, 'price-asc');

    const report = await importRows({ [collected.feedId]: [markedRow('Titulo recopilado secreto')] }, { feedId: collected.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 0, offersCreated: 1, ownProducts: [] });
    expect(await allProducts()).toEqual(productsBefore);
    expect(await getPublicProductBySlug(plain.slug)).toEqual(pageBefore);
    expect(await getPublicCategoryPage(target.slug, 1, null, 'price-asc')).toEqual(listingBefore);
    expect(JSON.stringify(await getPublicProductBySlug(plain.slug))).not.toContain('secreto');
    // Non-vacuity: the marked offer is stored, on the plain product.
    expect((await allOffers()).map((offer) => [offer.productId, offer.feedId])).toContainEqual([plain.id, collected.feedId]);
  });

  it('AC 29: with the flag on, beside a loopback origin, the same marked offer is on that page, and the product text is still the plain one', async () => {
    const hand = await aFeedOf();
    const collected = await collectedFeed();
    await mapFeed(hand.feedId);
    await mapFeed(collected.feedId);
    await importRows({ [hand.feedId]: [handRow('Titulo escrito a mano')] }, { feedId: hand.feedId });
    await importRows({ [collected.feedId]: [markedRow('Titulo recopilado secreto')] }, { feedId: collected.feedId });
    const [plain] = await allProducts();

    stubLocalFlag('on');
    const page = await getPublicProductBySlug(plain.slug);

    expect(page?.offers.map((offer) => offer.priceCents)).toEqual([500, 900]);
    expect(page?.title).toBe('Titulo escrito a mano');
  });

  it('AC 31: two collected feeds that share the key converge on one marked product, as two hand-written feeds do', async () => {
    const one = await collectedFeed('Recopilada uno');
    const two = await collectedFeed('Recopilada dos');

    await importRows({ [one.feedId]: [markedRow('Titulo uno')] }, { feedId: one.feedId });
    const report = await importRows({ [two.feedId]: [{ ...markedRow('Titulo dos'), id: 'recopilado-2' }] }, { feedId: two.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [] });
    const all = await allProducts();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ isCollected: true, title: 'Titulo uno' });
    expect((await allOffers()).map((offer) => offer.feedId)).toEqual([one.feedId, two.feedId]);
  });
});

describe('ambiguity counts the products a row can see (D-4, DS-6)', () => {
  const key = { brand: PLANTED.brand, part: PLANTED.part };

  it('an unmarked row beside one unmarked and one marked holder of its key attaches to the unmarked one: no ambiguity, no reason', async () => {
    const unmarked = await storedProduct({ slug: 'titular-escrito', ...key });
    await storedProduct({ slug: 'titular-recopilado', ...key, extra: { isCollected: true } });
    const hand = await aFeedOf();

    const report = await importRows({ [hand.feedId]: [keyRow('mano-1', key)] }, { feedId: hand.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [] });
    expect((await allOffers()).map((offer) => offer.productId)).toEqual([unmarked.id]);
  });

  it('a marked row sees both holders, so it is ambiguous and becomes its own marked product, as 0008 says', async () => {
    await storedProduct({ slug: 'titular-escrito', ...key });
    await storedProduct({ slug: 'titular-recopilado', ...key, extra: { isCollected: true } });
    const collected = await collectedFeed();

    const report = await importRows({ [collected.feedId]: [keyRow('recopilado-1', key)] }, { feedId: collected.feedId });

    expect(report.feeds[0]).toMatchObject({
      productsCreated: 1,
      ownProducts: [{ record: 2, reason: 'ambiguous_brand_part_number' }],
    });
    expect((await allProducts()).filter((row) => row.isCollected)).toHaveLength(2);
  });
});

describe('a marked row never sets or moves an unmarked product category (DS-9)', () => {
  const key = { brand: 'Alfa', ean: EAN.two };

  it('sets the category of the marked product it creates (non-vacuity for the guard below)', async () => {
    const collected = await collectedFeed();
    const [target] = await fiveTargets();
    await mapFeed(collected.feedId);

    await importRows({ [collected.feedId]: [keyRow('recopilado-1', { ...key, category: MAPPED })] }, { feedId: collected.feedId });

    const [marked] = await allProducts();
    expect(marked).toMatchObject({ isCollected: true, categoryId: target.id });
  });

  it('leaves an unmapped unmarked product unmapped, on the import that attaches and on the re-import that updates', async () => {
    const hand = await aFeedOf();
    const collected = await collectedFeed();
    await importRows({ [hand.feedId]: [keyRow('mano-1', key)] }, { feedId: hand.feedId });
    await mapFeed(collected.feedId);
    const row = [keyRow('recopilado-1', { ...key, category: MAPPED })];

    await importRows({ [collected.feedId]: row }, { feedId: collected.feedId });
    expect((await allProducts())[0]).toMatchObject({ isCollected: false, categoryId: null });
    await importRows({ [collected.feedId]: row }, { feedId: collected.feedId });

    expect((await allProducts())[0]).toMatchObject({ isCollected: false, categoryId: null });
  });

  it('leaves an already-mapped unmarked product in its own category', async () => {
    const hand = await aFeedOf();
    const collected = await collectedFeed();
    const [first, second] = await fiveTargets();
    await getDb().insert((await import('@/db/schema')).feedCategoryMappings).values({ feedId: hand.feedId, feedCategory: MAPPED, categoryId: second.id });
    await importRows({ [hand.feedId]: [keyRow('mano-1', { ...key, category: MAPPED })] }, { feedId: hand.feedId });
    await mapFeed(collected.feedId);
    expect((await allProducts())[0].categoryId).toBe(second.id);

    await importRows({ [collected.feedId]: [keyRow('recopilado-1', { ...key, category: MAPPED })] }, { feedId: collected.feedId });

    expect((await allProducts())[0].categoryId).toBe(second.id);
    expect(second.id).not.toBe(first.id);
  });
});

describe('the mapping writer moves only the products of the feed kind (DS-9)', () => {
  const save = (feedId: number, target: number) =>
    assignCategory(categoryForm({ feedId, feedCategory: 'Filtros', target }));

  async function twoProducts() {
    const collected = await collectedFeed();
    const hand = await aFeedOf();
    const marked = await productIn(collected.feedId, 'Filtros', { slug: 'marcado', product: { isCollected: true } });
    const plain = await productIn(hand.feedId, 'Filtros', { slug: 'escrito' });
    // An unmarked product whose only offer, by a direct write, sits in the collected feed's category.
    const attached = await productIn(collected.feedId, 'Filtros', { slug: 'escrito-con-oferta-recopilada' });
    return { collected, hand, marked, plain, attached };
  }

  it("a collected feed's mapping sets the category of marked products only, never an unmarked product that holds one of its offers", async () => {
    const { collected, marked, attached, plain } = await twoProducts();
    const [target] = await fiveTargets();

    const result = await save(collected.feedId, target.id);

    expect(result.status).toBe('saved');
    const rows = Object.fromEntries((await allProducts()).map((row) => [row.slug, row.categoryId]));
    expect(rows[marked.slug]).toBe(target.id);
    expect(rows[attached.slug]).toBeNull();
    expect(rows[plain.slug]).toBeNull();
  });

  it("removing a collected feed's mapping clears marked products only", async () => {
    const { collected, marked } = await twoProducts();
    const [target] = await fiveTargets();
    await save(collected.feedId, target.id);
    // An unmarked product already on that same target and carrying a collected offer in that feed category:
    // leaving the target would clear it if the writer did not leave unmarked products alone.
    const shared = await productIn(collected.feedId, 'Filtros', { slug: 'compartido', categoryId: target.id });

    const result = await removeCategoryMapping(categoryForm({ feedId: collected.feedId, feedCategory: 'Filtros' }));

    expect(result.status).toBe('saved');
    const rows = Object.fromEntries((await allProducts()).map((row) => [row.slug, row.categoryId]));
    expect(rows[marked.slug]).toBeNull();
    expect(rows[shared.slug]).toBe(target.id);
  });

  it("an unmarked feed's mapping never touches a marked product that holds one of its offers", async () => {
    const hand = await aFeedOf();
    const [target] = await fiveTargets();
    const plain = await productIn(hand.feedId, 'Filtros', { slug: 'escrito' });
    // A marked product that, by a direct write, also carries an offer of the hand-written feed.
    const marked = await productIn(hand.feedId, 'Filtros', { slug: 'marcado-con-oferta-escrita', product: { isCollected: true } });

    const result = await save(hand.feedId, target.id);

    expect(result.status).toBe('saved');
    const rows = Object.fromEntries((await allProducts()).map((row) => [row.slug, row.categoryId]));
    expect(rows[plain.slug]).toBe(target.id);
    expect(rows[marked.slug]).toBeNull();
  });
});

describe('a fitment cell in a collected file counts for nothing, flag on or off (AC 32)', () => {
  it('imports without failing, and no vehicle list, fit state or car count shows it', async () => {
    const collected = await collectedFeed();
    await mapFeed(collected.feedId);
    const carId = await vehicleIdBySlug(CAR.slug);
    const row = { ...keyRow('recopilado-1', { brand: 'Alfa', category: MAPPED }), fitment: CAR.slug };

    const report = await importRows({ [collected.feedId]: [row] }, { feedId: collected.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rejected: [], unknownVehicles: 0 });
    const [marked] = await allProducts();
    stubLocalFlag('on');
    expect(await getPublicProductBySlug(marked.slug)).not.toBeNull();
    expect(await readProductVehicles(marked.slug)).toEqual([]);
    expect(await readProductFitState(marked.slug, carId)).toBe('unknown');
    const [target] = await fiveTargets();
    expect((await getPublicCategoryPage(target.slug, 1, null, 'price-asc', carId))?.fit).toMatchObject({ fitsCount: 0, unknownCount: 1 });
    stubLocalFlag('off');
    expect(await readProductVehicles(marked.slug)).toEqual([]);
    expect(await readProductFitState(marked.slug, carId)).toBe('unknown');
  });

  it('adds no vehicle to an unmarked product the collected row attached to', async () => {
    const hand = await aFeedOf();
    const collected = await collectedFeed();
    await mapFeed(hand.feedId);
    const handRow = { ...keyRow('mano-1', { brand: 'Alfa', ean: EAN.three, category: MAPPED }), fitment: '' };
    await importRows({ [hand.feedId]: [handRow] }, { feedId: hand.feedId });
    const row = { ...keyRow('recopilado-1', { brand: 'Alfa', ean: EAN.three }), fitment: CAR.slug };

    await importRows({ [collected.feedId]: [row] }, { feedId: collected.feedId });

    const [plain] = await allProducts();
    expect(plain.isCollected).toBe(false);
    expect(await readProductVehicles(plain.slug)).toEqual([]);
    expect(await readProductFitState(plain.slug, await vehicleIdBySlug(CAR.slug))).toBe('unknown');
  });

  it('non-vacuity: the same cell in a hand-written file does count', async () => {
    const hand = await aFeedOf();
    await mapFeed(hand.feedId);
    const row = { ...keyRow('mano-1', { brand: 'Alfa', category: MAPPED }), fitment: CAR.slug };

    await importRows({ [hand.feedId]: [row] }, { feedId: hand.feedId });

    const [plain] = await allProducts();
    expect((await readProductVehicles(plain.slug)).map((vehicle) => vehicle.slug)).toEqual([CAR.slug]);
    expect(await readProductFitState(plain.slug, await vehicleIdBySlug(CAR.slug))).toBe('fits');
    expect((await getDb().select().from(fitments)).length).toBeGreaterThan(0);
  });
});

describe('an unapproved collected feed imports nothing (guardrail 1)', () => {
  it('is skipped as not_approved, its rows are never read and no product is written', async () => {
    const collected = await aFeedOf('Tienda recopilada', { feedApproved: false, sourceType: 'collected_file' });

    const report = await importRows({ [collected.feedId]: ROWS }, { feedId: collected.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'skipped', skipReason: 'not_approved', productsCreated: 0, offersCreated: 0 });
    expect(await allProducts()).toEqual([]);
    expect(await allOffers()).toEqual([]);
  });
});
