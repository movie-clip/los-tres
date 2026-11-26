import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';
import { listProductsForAdmin, readProductForAdmin } from '@/server/admin/products';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { buildProductJsonLd } from '@/server/catalogue/product-jsonld';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { formatImportReport, importExitCode } from '@/server/importer';

import { allOffers, allProducts, insertOffer } from '../support/catalogue';
import { fiveTargets } from '../support/categories';
import { resetDatabase } from '../support/db';
import { EAN, aFeedOf, importRows, keyRow, storedProduct } from '../support/matching';
import { stubNetworkOff } from '../support/network-off';

// A hang guard (0006, rule 4): the file runs real imports.
vi.setConfig({ testTimeout: 30_000 });

// S7.6 (US-7.6): a product with no EAN takes the valid EAN of the first eligible row of its own, on a
// new join and from a known offer. ACs 1 to 7 and 12 to 22 live here; ACs 8 to 11 (the collected wall)
// are in collected-ean-fill.test.ts, the pure decision (and its order) in unit/ean-fill.test.ts, the line
// in unit/import-report.test.ts. States the import cannot reach (a hidden product, an offer in review, a
// marked product) are set up by hand through `storedProduct` and `insertOffer`, as importer-brand-part-number
// does; no fixture file is added. Every shop, product and link is invented.

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

const KEY = { brand: 'MarcaUno', part: 'PN 100' };
const OTHER_KEY = { brand: 'MarcaDos', part: 'PN 200' };
/** A valid EAN-13 whose check digit is wrong: the row is rejected as invalid_ean. */
const BAD_EAN = '2000000000047';

type Offer = Awaited<ReturnType<typeof allOffers>>[number];

/** An offer without what an import rewrites on a known offer (price, link, date): what must stay equal. */
const stable = (offer: Offer) => ({ ...offer, priceCents: 0, url: '', priceUpdatedAt: new Date(0) });

type Report = Awaited<ReturnType<typeof importRows>>;

/** The printed output split into lines, so a test reads the lines and not the counts. */
const linesOf = (report: Report) => formatImportReport(report).split('\n');
const EAN_LINE = /^ {2}ean:/;
const eanLines = (report: Report) => linesOf(report).filter((line) => EAN_LINE.test(line));

/**
 * One feed (named, so two worlds print alike) holding a known offer 'x-1' on a stored product that has no
 * EAN (or the `ean` given). `productExtra` and `offerExtra` set the one state a case is about.
 */
async function world(
  o: {
    shopApproved?: boolean;
    feedApproved?: boolean;
    ean?: string | null;
    slug?: string;
    productExtra?: Parameters<typeof storedProduct>[0]['extra'];
    offerExtra?: Partial<typeof offers.$inferInsert>;
  } = {},
) {
  const feed = await aFeedOf('Tienda Fija', { shopApproved: o.shopApproved, feedApproved: o.feedApproved });
  const product = await storedProduct({ slug: o.slug ?? 'sin-ean', ...KEY, ean: o.ean ?? null, extra: o.productExtra });
  const offerId = await insertOffer({
    productId: product.id,
    feedId: feed.feedId,
    externalId: 'x-1',
    priceCents: 1000,
    ...o.offerExtra,
  });
  return { feed, product, offerId };
}

/** Imports the one feed with the row for the known offer 'x-1'. */
const importX = (feedId: number, o: { ean?: string; price?: string } = {}) =>
  importRows({ [feedId]: [keyRow('x-1', { ...KEY, ean: o.ean, price: o.price ?? '10.00' })] }, { feedId });

/** The product `id` as stored now. */
async function productRow(id: number) {
  const row = (await allProducts()).find((product) => product.id === id);
  if (!row) throw new Error(`no product ${id}`);
  return row;
}

describe('when the fill happens (AC 1, 2, 3)', () => {
  it('AC 1: a new row that joins by brand and part number gives the product with no EAN the EAN written', async () => {
    const a = await aFeedOf('Tienda Alfa');
    const b = await aFeedOf('Tienda Beta');
    await importRows({ [a.feedId]: [keyRow('a-1', KEY)] }, { feedId: a.feedId });
    const before = await allProducts();

    const report = await importRows({ [b.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 0, offersCreated: 1, rejected: [], ownProducts: [], eanFilled: 1 });
    expect(await allProducts()).toEqual([{ ...before[0], ean: EAN.one, eanNormalised: EAN.one }]);
    expect((await allOffers()).map((offer) => [offer.productId, offer.externalId])).toEqual([
      [before[0].id, 'a-1'],
      [before[0].id, 'b-1'],
    ]);
  });

  it('AC 1: writes the two values creation writes, the cell as written (trimmed) and its digit form', async () => {
    const a = await aFeedOf('Tienda Alfa');
    const b = await aFeedOf('Tienda Beta');
    await importRows({ [a.feedId]: [keyRow('a-1', KEY)] }, { feedId: a.feedId });

    await importRows({ [b.feedId]: [keyRow('b-1', { ...KEY, ean: ' 2000-0000-00046 ' })] }, { feedId: b.feedId });

    expect(await allProducts()).toMatchObject([{ ean: '2000-0000-00046', eanNormalised: EAN.one }]);
  });

  it('AC 2: a known offer whose row carries a valid EAN fills the product it sits on, on an ordinary import', async () => {
    const { feed, product } = await world();
    const before = await allProducts();
    const offersBefore = await allOffers();

    const report = await importX(feed.feedId, { ean: EAN.one, price: '9.00' });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1, rejected: [], ownProducts: [], eanFilled: 1 });
    expect(await allProducts()).toEqual([{ ...before[0], ean: EAN.one, eanNormalised: EAN.one }]);
    const offersAfter = await allOffers();
    expect(offersAfter.map((offer) => [offer.id, offer.productId, offer.priceCents])).toEqual([[offersBefore[0].id, product.id, 900]]);
  });

  it('AC 3: a shop approved between two imports: the first fills nothing, the second fills (known offer)', async () => {
    const { feed } = await world({ shopApproved: false });

    const first = await importX(feed.feedId, { ean: EAN.one });
    expect(first.feeds[0]).toMatchObject({ eanFilled: 0, offersUpdated: 1 });
    expect((await allProducts())[0]).toMatchObject({ ean: null, eanNormalised: null });

    await getDb().update(shops).set({ isApproved: true }).where(eq(shops.id, feed.shopId));
    const second = await importX(feed.feedId, { ean: EAN.one });

    expect(second.feeds[0]).toMatchObject({ eanFilled: 1, offersUpdated: 1 });
    expect(eanLines(second)).toEqual(['  ean: filled=1']);
    expect((await allProducts())[0]).toMatchObject({ ean: EAN.one, eanNormalised: EAN.one });
  });

  it('AC 3: a shop approved between two imports: the offer that joined while it was unapproved fills on the next import', async () => {
    const a = await aFeedOf('Tienda Alfa');
    const b = await aFeedOf('Tienda Beta', { shopApproved: false });
    await importRows({ [a.feedId]: [keyRow('a-1', KEY)] }, { feedId: a.feedId });

    const first = await importRows({ [b.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });
    expect(first.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, eanFilled: 0 });
    expect((await allProducts())[0]).toMatchObject({ ean: null });

    await getDb().update(shops).set({ isApproved: true }).where(eq(shops.id, b.shopId));
    const second = await importRows({ [b.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });

    expect(second.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1, eanFilled: 1 });
    expect((await allProducts())[0]).toMatchObject({ ean: EAN.one, eanNormalised: EAN.one });
  });
});

describe('first wins, and two EANs (AC 4, 5)', () => {
  it('AC 4: two rows of one import with the same EAN fill once; the second reaches the product by EAN, whatever its part number', async () => {
    const product = await storedProduct({ slug: 'sin-ean', ...KEY });
    const feed = await aFeedOf();

    const report = await importRows({
      [feed.feedId]: [
        keyRow('r-1', { ...KEY, ean: EAN.one }),
        // Another part number: no key matches, so only the EAN the first row just wrote can bring it here.
        keyRow('r-2', { brand: KEY.brand, part: 'PN 999', ean: EAN.one }),
      ],
    });

    expect(report.feeds[0]).toMatchObject({ rows: 2, productsCreated: 0, offersCreated: 2, rejected: [], ownProducts: [], eanFilled: 1 });
    expect((await allProducts()).map((row) => [row.id, row.eanNormalised])).toEqual([[product.id, EAN.one]]);
    expect((await allOffers()).map((offer) => offer.productId)).toEqual([product.id, product.id]);
  });

  it('AC 4: two imports of two feeds with the same EAN: the first fills, the second attaches by EAN and fills nothing', async () => {
    const product = await storedProduct({ slug: 'sin-ean', ...KEY });
    const b = await aFeedOf('Tienda Beta');
    const c = await aFeedOf('Tienda Gamma');

    const first = await importRows({ [b.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });
    const second = await importRows({ [c.feedId]: [keyRow('c-1', { brand: KEY.brand, part: 'PN 999', ean: EAN.one })] }, { feedId: c.feedId });

    expect(first.feeds[0]).toMatchObject({ eanFilled: 1 });
    expect(second.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [], eanFilled: 0 });
    expect(eanLines(second)).toEqual([]);
    expect((await allOffers()).map((offer) => offer.productId)).toEqual([product.id, product.id]);
    expect(await allProducts()).toHaveLength(1);
  });

  it.each([
    ['the first EAN is the lower one', EAN.one, EAN.two],
    ['the first EAN is the higher one', EAN.two, EAN.one],
  ])('AC 5: two different EANs for one product in one import: the first fills, the second row is its own product (%s)', async (_label, first, second) => {
    const product = await storedProduct({ slug: 'sin-ean', ...KEY });
    const feed = await aFeedOf();

    const report = await importRows({
      [feed.feedId]: [keyRow('r-1', { ...KEY, ean: first }), keyRow('r-2', { ...KEY, ean: second })],
    });

    expect(report.feeds[0]).toMatchObject({
      productsCreated: 1,
      offersCreated: 2,
      rejected: [],
      ownProducts: [{ record: 3, reason: 'brand_part_number_ean_conflict' }],
      eanFilled: 1,
    });
    expect(linesOf(report).filter((line) => line.includes('own_product'))).toEqual([
      '  record 3: own_product brand_part_number_ean_conflict',
    ]);
    const rows = await allProducts();
    expect(rows.map((row) => row.eanNormalised)).toEqual([first, second]);
    expect(rows[0].id).toBe(product.id);
    const byOffer = Object.fromEntries((await allOffers()).map((offer) => [offer.externalId, offer.productId]));
    expect(byOffer).toEqual({ 'r-1': rows[0].id, 'r-2': rows[1].id });
  });

  it('AC 5: the same two EANs from two feeds in two imports: the later one is its own product with one line', async () => {
    await storedProduct({ slug: 'sin-ean', ...KEY });
    const b = await aFeedOf('Tienda Beta');
    const c = await aFeedOf('Tienda Gamma');
    await importRows({ [b.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });

    const report = await importRows({ [c.feedId]: [keyRow('c-1', { ...KEY, ean: EAN.two })] }, { feedId: c.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 1, ownProducts: [{ record: 2, reason: 'brand_part_number_ean_conflict' }], eanFilled: 0 });
    expect((await allProducts()).map((row) => row.eanNormalised)).toEqual([EAN.one, EAN.two]);
  });

  it('AC 5: a known offer whose row carries another EAN than its product now holds stays, changes nothing and prints nothing (D-16)', async () => {
    const { feed } = await world({ ean: EAN.one });
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();

    const report = await importX(feed.feedId, { ean: EAN.two, price: '8.00' });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1, ownProducts: [], rejected: [], eanFilled: 0 });
    expect(linesOf(report)).toHaveLength(2); // the feed's line and the total: no ean, no own_product, no reject line
    expect(await allProducts()).toEqual(productsBefore);
    expect((await allOffers()).map(stable)).toEqual(offersBefore.map(stable));
  });
});

describe('the approval and hide gate: a row that is not eligible fills nothing (AC 6)', () => {
  // One case per condition (D-18). The offer is stored or updated exactly as today; the product keeps no
  // EAN and keeps its public state. The control row (AC 2) fills, so none of these is vacuous.
  const known: [string, Parameters<typeof world>[0]][] = [
    ['its shop is not approved', { shopApproved: false }],
    ['its offer is hidden', { offerExtra: { isHidden: true } }],
    ['its offer is in review', { offerExtra: { inReview: true } }],
    ['the product it sits on is hidden', { productExtra: { isHidden: true } }],
  ];

  it.each(known)('a known offer fills nothing when %s, and the offer is updated as today', async (_label, setup) => {
    const { feed, product } = await world(setup);
    const productBefore = await productRow(product.id);
    const offersBefore = await allOffers();
    const pageBefore = await getPublicProductBySlug(product.slug);

    const report = await importX(feed.feedId, { ean: EAN.one, price: '9.00' });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersUpdated: 1, rejected: [], ownProducts: [], eanFilled: 0 });
    expect(eanLines(report)).toEqual([]);
    expect(await productRow(product.id)).toEqual(productBefore);
    const offersAfter = await allOffers();
    expect(offersAfter.map((offer) => offer.priceCents)).toEqual([900]);
    expect(offersAfter.map(stable)).toEqual(offersBefore.map(stable)); // no flag, owner or product moved
    expect(await getPublicProductBySlug(product.slug)).toEqual(pageBefore);
  });

  it('a known offer of a feed that is not approved is skipped, and nothing is filled', async () => {
    const { feed, product } = await world({ feedApproved: false });
    const productBefore = await productRow(product.id);
    const offersBefore = await allOffers();

    const report = await importX(feed.feedId, { ean: EAN.one, price: '9.00' });

    expect(report.feeds[0]).toMatchObject({ outcome: 'skipped', eanFilled: 0 });
    expect(eanLines(report)).toEqual([]);
    expect(await productRow(product.id)).toEqual(productBefore);
    expect(await allOffers()).toEqual(offersBefore);
  });

  it.each([
    ['its shop is not approved', { shopApproved: false }, {}],
    ['the product it joins is hidden', { shopApproved: true }, { isHidden: true }],
  ])('a new row fills nothing when %s, and it still joins as an offer', async (_label, shop, productExtra) => {
    const product = await storedProduct({ slug: 'sin-ean', ...KEY, extra: productExtra });
    const feed = await aFeedOf('Tienda Beta', shop);
    const productBefore = await productRow(product.id);

    const report = await importRows({ [feed.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: feed.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [], eanFilled: 0 });
    expect(eanLines(report)).toEqual([]);
    expect(await productRow(product.id)).toEqual(productBefore);
    expect((await allOffers()).map((offer) => offer.productId)).toEqual([product.id]);
  });

  it('a new row has no hidden or in-review offer to be refused for: the insert sets neither (control: it fills)', async () => {
    await storedProduct({ slug: 'sin-ean', ...KEY });
    const feed = await aFeedOf('Tienda Beta');

    const report = await importRows({ [feed.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: feed.feedId });

    expect(report.feeds[0]).toMatchObject({ eanFilled: 1 });
    expect(await allOffers()).toMatchObject([{ isHidden: false, inReview: false }]);
  });

  it('AC 6: a product unhidden later is filled by the next import: the refusal is not remembered, and the unhide itself wrote no EAN', async () => {
    const { feed, product } = await world({ productExtra: { isHidden: true } });
    await importX(feed.feedId, { ean: EAN.one });

    await getDb().update(products).set({ isHidden: false }).where(eq(products.id, product.id));

    expect(await productRow(product.id)).toMatchObject({ ean: null, eanNormalised: null, isHidden: false });
    // Eligible again, so the next import is the one that fills (AC 3's shape, for the hide).
    const again = await importX(feed.feedId, { ean: EAN.one });
    expect(again.feeds[0]).toMatchObject({ eanFilled: 1 });
  });
});

describe('a fill changes no approval, hide, review, category or public state (AC 7)', () => {
  const snapshot = async () => ({
    shops: await getDb().select().from(shops).orderBy(shops.id),
    feeds: await getDb().select().from(feeds).orderBy(feeds.id),
    offers: (await allOffers()).map(stable),
    products: (await allProducts()).map((row) => ({ ...row, ean: null, eanNormalised: null })),
  });

  it('leaves every shop, feed, offer flag and product column but the EAN as it was, and the page public under the same rule', async () => {
    const [target] = await fiveTargets();
    const a = await aFeedOf('Tienda Alfa');
    const b = await aFeedOf('Tienda Beta');
    const product = await storedProduct({ slug: 'filtro', ...KEY, extra: { categoryId: target.id } });
    await insertOffer({ productId: product.id, feedId: a.feedId, externalId: 'a-1', priceCents: 1050 });
    await insertOffer({ productId: product.id, feedId: b.feedId, externalId: 'b-1', priceCents: 1000 });
    const before = await snapshot();
    expect(await getPublicProductBySlug(product.slug)).not.toBeNull();

    const report = await importRows({ [b.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });

    expect(report.feeds[0]).toMatchObject({ eanFilled: 1 });
    expect(await snapshot()).toEqual(before);
    expect(await getPublicProductBySlug(product.slug)).not.toBeNull();
  });

  it('does not make a product public that was not: with no category it is filled and stays off the site', async () => {
    const b = await aFeedOf('Tienda Beta');
    const product = await storedProduct({ slug: 'sin-categoria', ...KEY, extra: { categoryId: null } });
    await insertOffer({ productId: product.id, feedId: b.feedId, externalId: 'b-1', priceCents: 1000 });
    expect(await getPublicProductBySlug(product.slug)).toBeNull();

    const report = await importRows({ [b.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });

    expect(report.feeds[0]).toMatchObject({ eanFilled: 1 });
    expect(await productRow(product.id)).toMatchObject({ eanNormalised: EAN.one, categoryId: null });
    expect(await getPublicProductBySlug(product.slug)).toBeNull();
  });

  it('a fill made after the admin approved the shop leaves that approval, and every other flag, as the admin set it', async () => {
    const { feed, product } = await world({ shopApproved: false });
    await getDb().update(shops).set({ isApproved: true }).where(eq(shops.id, feed.shopId));
    const before = await snapshot();

    await importX(feed.feedId, { ean: EAN.one });

    expect(await snapshot()).toEqual(before);
    expect((await productRow(product.id)).eanNormalised).toBe(EAN.one);
  });
});

describe('another product holds the EAN (AC 12, 13)', () => {
  const holder = (extra?: Parameters<typeof storedProduct>[0]['extra']) =>
    storedProduct({ slug: 'titular', ...OTHER_KEY, ean: EAN.one, extra });

  it.each([
    ['a visible holder', undefined],
    ['a hidden holder (it still counts)', { isHidden: true }],
  ])('AC 12: a known offer fills nothing while %s exists; nothing is merged, moved, created or printed', async (_label, holderExtra) => {
    const { feed, product } = await world();
    await holder(holderExtra);
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();

    const report = await importX(feed.feedId, { ean: EAN.one });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1, ownProducts: [], rejected: [], eanFilled: 0 });
    expect(linesOf(report)).toHaveLength(2);
    expect(await allProducts()).toEqual(productsBefore);
    expect((await allOffers()).map((offer) => [offer.id, offer.productId])).toEqual(offersBefore.map((offer) => [offer.id, offer.productId]));
    expect((await productRow(product.id)).eanNormalised).toBeNull();
  });

  it('AC 12: the refusal repeats on every import and prints nothing again, until the holder is gone', async () => {
    const { feed, product } = await world();
    await holder();

    await importX(feed.feedId, { ean: EAN.one });
    const again = await importX(feed.feedId, { ean: EAN.one });
    expect(again.feeds[0]).toMatchObject({ eanFilled: 0 });
    expect(eanLines(again)).toEqual([]);

    await getDb().update(products).set({ ean: null, eanNormalised: null }).where(eq(products.slug, 'titular'));
    const last = await importX(feed.feedId, { ean: EAN.one });
    expect(last.feeds[0]).toMatchObject({ eanFilled: 1 });
    expect((await productRow(product.id)).eanNormalised).toBe(EAN.one);
  });

  it('AC 13: a marked product is no holder for an unmarked row: a known offer fills while a marked product has the EAN', async () => {
    const { feed, product } = await world();
    await holder({ isCollected: true });

    const report = await importX(feed.feedId, { ean: EAN.one });

    expect(report.feeds[0]).toMatchObject({ eanFilled: 1 });
    expect((await productRow(product.id)).eanNormalised).toBe(EAN.one);
  });

  it('AC 13: a marked product is no holder for an unmarked new row either: the row joins by key and fills', async () => {
    const product = await storedProduct({ slug: 'sin-ean', ...KEY });
    await holder({ isCollected: true });
    const feed = await aFeedOf('Tienda Beta');

    const report = await importRows({ [feed.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one })] }, { feedId: feed.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [], eanFilled: 1 });
    expect((await productRow(product.id)).eanNormalised).toBe(EAN.one);
  });

  it.each([
    ['an unmarked', undefined],
    ['a marked', { isCollected: true }],
  ])('AC 13: %s holder blocks a marked row: a known offer of a collected feed fills nothing', async (_label, holderExtra) => {
    const feed = await aFeedOf('Tienda Recopilada', { sourceType: 'collected_file' });
    const marked = await storedProduct({ slug: 'marcado', ...KEY, extra: { isCollected: true } });
    await insertOffer({ productId: marked.id, feedId: feed.feedId, externalId: 'x-1', priceCents: 1000 });
    await holder(holderExtra);
    const before = await productRow(marked.id);

    const report = await importX(feed.feedId, { ean: EAN.one });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersUpdated: 1, eanFilled: 0 });
    expect(eanLines(report)).toEqual([]);
    expect(await productRow(marked.id)).toEqual(before);
  });

  it('AC 13: control for the two above: with no holder at all the same marked row fills the marked product', async () => {
    const feed = await aFeedOf('Tienda Recopilada', { sourceType: 'collected_file' });
    const marked = await storedProduct({ slug: 'marcado', ...KEY, extra: { isCollected: true } });
    await insertOffer({ productId: marked.id, feedId: feed.feedId, externalId: 'x-1', priceCents: 1000 });

    const report = await importX(feed.feedId, { ean: EAN.one });

    expect(report.feeds[0]).toMatchObject({ eanFilled: 1 });
    expect((await productRow(marked.id)).eanNormalised).toBe(EAN.one);
  });
});

describe('no EAN, an invalid EAN, and an EAN already set (AC 14, 15, 16)', () => {
  it('AC 14: a row with no EAN fills nothing, new or known', async () => {
    const { feed, product } = await world();
    const before = await productRow(product.id);
    const known = await importX(feed.feedId);
    expect(known.feeds[0]).toMatchObject({ offersUpdated: 1, eanFilled: 0 });

    const b = await aFeedOf('Tienda Beta');
    const joined = await importRows({ [b.feedId]: [keyRow('b-1', KEY)] }, { feedId: b.feedId });

    expect(joined.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, eanFilled: 0 });
    expect(await productRow(product.id)).toEqual(before);
  });

  it('AC 14: a known offer whose row has an invalid EAN is rejected as invalid_ean: its offer is not updated and nothing fills', async () => {
    const { feed, product } = await world();
    const productBefore = await productRow(product.id);
    const offersBefore = await allOffers();

    const report = await importX(feed.feedId, { ean: BAD_EAN, price: '9.00' });

    expect(report.feeds[0]).toMatchObject({ offersUpdated: 0, rejected: [{ record: 2, code: 'invalid_ean', field: 'ean' }], eanFilled: 0 });
    expect(await productRow(product.id)).toEqual(productBefore);
    expect(await allOffers()).toEqual(offersBefore);
  });

  it('AC 14: a new row with an invalid EAN is rejected before matching: no offer, no product, no fill', async () => {
    const product = await storedProduct({ slug: 'sin-ean', ...KEY });
    const before = await productRow(product.id);
    const feed = await aFeedOf('Tienda Beta');

    const report = await importRows({ [feed.feedId]: [keyRow('b-1', { ...KEY, ean: BAD_EAN })] }, { feedId: feed.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, rejected: [{ record: 2, code: 'invalid_ean' }], eanFilled: 0 });
    expect(await allOffers()).toEqual([]);
    expect(await allProducts()).toEqual([before]);
  });

  it.each([
    ['no EAN', undefined],
    ['another EAN', EAN.two],
    ['the same EAN', EAN.one],
  ])('AC 15: a product with an EAN keeps it when a known offer\'s row has %s, and only the offer\'s price and date change', async (_label, rowEan) => {
    const { feed } = await world({ ean: EAN.one });
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();

    const report = await importX(feed.feedId, { ean: rowEan, price: '7.77' });

    expect(report.feeds[0]).toMatchObject({ offersUpdated: 1, ownProducts: [], eanFilled: 0 });
    expect(eanLines(report)).toEqual([]);
    expect(await allProducts()).toEqual(productsBefore);
    const offersAfter = await allOffers();
    expect(offersAfter.map((offer) => offer.priceCents)).toEqual([777]);
    expect(offersAfter.map(stable)).toEqual(offersBefore.map(stable));
  });

  it.each([
    ['only the cell', { ean: EAN.one, eanNormalised: null }],
    ['only the digit form', { ean: null, eanNormalised: EAN.one }],
  ])('AC 15: a product with %s set counts as having an EAN and is never written to (DT-4)', async (_label, half) => {
    const { feed, product } = await world({ productExtra: half });
    const before = await productRow(product.id);

    const report = await importX(feed.feedId, { ean: EAN.two });

    expect(report.feeds[0]).toMatchObject({ eanFilled: 0 });
    expect(await productRow(product.id)).toEqual(before);
  });

  it('AC 15: no import clears an EAN: a product that was filled keeps it through rows with no EAN, an invalid one and another', async () => {
    const { feed, product } = await world();
    await importX(feed.feedId, { ean: EAN.one });

    await importX(feed.feedId);
    await importX(feed.feedId, { ean: BAD_EAN });
    await importX(feed.feedId, { ean: EAN.two });

    expect(await productRow(product.id)).toMatchObject({ ean: EAN.one, eanNormalised: EAN.one });
  });

  it('AC 16: the stored product differs after a fill in its two EAN columns and no other, and its offer is written as today', async () => {
    const [target] = await fiveTargets();
    const { feed, product } = await world({ productExtra: { description: 'Descripcion de la primera', categoryId: target.id } });
    const before = await productRow(product.id);
    const offersBefore = await allOffers();

    const row = keyRow('x-1', { ...KEY, ean: EAN.one, price: '9.50', title: 'Otro titulo', url: 'https://tienda-fija.example/p/nuevo' });
    const report = await importRows({ [feed.feedId]: [{ ...row, brand: 'MARCA  UNO' }] }, { feedId: feed.feedId });

    expect(report.feeds[0]).toMatchObject({ eanFilled: 1 });
    expect(await productRow(product.id)).toEqual({ ...before, ean: EAN.one, eanNormalised: EAN.one });
    const [offer] = await allOffers();
    expect(offer).toMatchObject({ id: offersBefore[0].id, productId: product.id, priceCents: 950, url: 'https://tienda-fija.example/p/nuevo' });
    expect(stable(offer)).toEqual(stable(offersBefore[0]));
  });
});

describe('the import output (AC 17, 18, 19)', () => {
  it('AC 17: the feed that filled prints one line with the count of products, after the own_product lines', async () => {
    await storedProduct({ slug: 'uno', ...KEY });
    await storedProduct({ slug: 'dos', ...OTHER_KEY, ean: EAN.two });
    const feed = await aFeedOf('Tienda Fija');

    const report = await importRows({
      [feed.feedId]: [
        keyRow('r-1', { ...KEY, ean: EAN.one }),
        keyRow('r-2', { ...OTHER_KEY, ean: EAN.three }), // the product has another EAN: its own product
      ],
    });

    expect(linesOf(report).slice(1)).toEqual([
      '  record 3: own_product brand_part_number_ean_conflict',
      '  ean: filled=1',
      'total: feeds=1 imported=1 skipped=0 failed=0',
    ]);
  });

  it('AC 17: counts products, not rows: two rows for one product count once, two products count two', async () => {
    await storedProduct({ slug: 'uno', ...KEY });
    await storedProduct({ slug: 'dos', ...OTHER_KEY });
    const feed = await aFeedOf('Tienda Fija');

    const report = await importRows({
      [feed.feedId]: [
        keyRow('r-1', { ...KEY, ean: EAN.one }),
        keyRow('r-2', { ...KEY, ean: EAN.one }),
        keyRow('r-3', { ...OTHER_KEY, ean: EAN.two }),
      ],
    });

    expect(report.feeds[0].eanFilled).toBe(2);
    expect(eanLines(report)).toEqual(['  ean: filled=2']);
  });

  it('AC 17: the line carries no row text, EAN, record number or link', async () => {
    const { feed } = await world();

    const text = formatImportReport(await importX(feed.feedId, { ean: EAN.one }));

    expect(text).toContain('\n  ean: filled=1\n');
    expect(text).not.toContain(EAN.one);
    expect(text).not.toMatch(/https?:|\.example|PN 100|MarcaUno/);
  });

  it.each([
    ['its shop is not approved', { shopApproved: false }],
    ['its offer is hidden', { offerExtra: { isHidden: true } }],
    ['its offer is in review', { offerExtra: { inReview: true } }],
    ['its product is hidden', { productExtra: { isHidden: true } }],
    ['the product already has an EAN', { ean: EAN.two }],
  ])('AC 18: a feed whose row is refused because %s prints byte for byte what the same row without an EAN prints', async (_label, setup) => {
    const withEan = await world(setup);
    const printed = formatImportReport(await importX(withEan.feed.feedId, { ean: EAN.one }));
    await resetDatabase();
    const twin = await world(setup);
    const printedWithout = formatImportReport(await importX(twin.feed.feedId));

    const sameFeed = (text: string) => text.replace(/^feed \d+ /gm, 'feed N ');
    expect(sameFeed(printed)).toBe(sameFeed(printedWithout));
    expect(printed).not.toMatch(/^ {2}ean:/m);
  });

  it('AC 18: a holder refusal prints the feed line and the total only', async () => {
    const { feed } = await world();
    await storedProduct({ slug: 'titular', ...OTHER_KEY, ean: EAN.one });

    const held = formatImportReport(await importX(feed.feedId, { ean: EAN.one }));

    expect(held).not.toMatch(/^ {2}ean:/m);
    expect(held.split('\n')).toHaveLength(2);
  });

  it('AC 19: a run that fills exits 0', async () => {
    const { feed } = await world();

    const report = await importX(feed.feedId, { ean: EAN.one });

    expect(report.feeds[0].eanFilled).toBe(1);
    expect(importExitCode(report)).toBe(0);
  });

  it('AC 19: a run that fills and also has a failed feed exits 1, and the failed feed\'s fills are rolled back with it', async () => {
    const a = await world({ slug: 'de-alfa' });
    const bFeed = await aFeedOf('Tienda Beta');
    const other = await storedProduct({ slug: 'de-beta', ...OTHER_KEY });
    await insertOffer({ productId: other.id, feedId: bFeed.feedId, externalId: 'b-1', priceCents: 1000 });
    const db = getDb();
    await db.execute(
      sql.raw("create function fail_boom() returns trigger language plpgsql as $$ begin raise exception 'boom' using errcode = 'P0001'; end $$"),
    );
    await db.execute(sql.raw("create trigger fail_boom before insert on offers for each row when (new.external_id = 'boom') execute function fail_boom()"));
    let report: Report;
    try {
      report = await importRows({
        [a.feed.feedId]: [keyRow('x-1', { ...KEY, ean: EAN.one })],
        // Row 1 fills `de-beta` inside the transaction; row 2 then fails it.
        [bFeed.feedId]: [keyRow('b-1', { ...OTHER_KEY, ean: EAN.two }), keyRow('boom', { brand: 'Otra', part: 'PN 1' })],
      });
    } finally {
      await db.execute(sql.raw('drop trigger if exists fail_boom on offers'));
      await db.execute(sql.raw('drop function if exists fail_boom()'));
    }

    expect(report.feeds.map((feed) => feed.outcome)).toEqual(['imported', 'failed']);
    expect(report.feeds[0].eanFilled).toBe(1);
    expect(importExitCode(report)).toBe(1);
    expect(linesOf(report).filter((line) => EAN_LINE.test(line))).toEqual(['  ean: filled=1']);
    expect(linesOf(report).find((line) => line.includes('failed'))).toContain('failed database_error');
    expect((await productRow(a.product.id)).eanNormalised).toBe(EAN.one);
    expect((await productRow(other.id)).eanNormalised).toBeNull(); // rolled back with its feed
  });
});

describe('a repeat import (AC 20)', () => {
  it('changes nothing but prices and dates: nothing fills again, no line is printed, no product or offer is created or moved', async () => {
    const { feed } = await world();
    const first = await importX(feed.feedId, { ean: EAN.one, price: '9.00' });
    expect(first.feeds[0]).toMatchObject({ eanFilled: 1 });
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();

    const second = await importX(feed.feedId, { ean: EAN.one, price: '8.00' });

    expect(second.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1, ownProducts: [], rejected: [], eanFilled: 0 });
    expect(eanLines(second)).toEqual([]);
    expect(await allProducts()).toEqual(productsBefore);
    const offersAfter = await allOffers();
    expect(offersAfter.map((offer) => offer.priceCents)).toEqual([800]);
    expect(offersAfter.map(stable)).toEqual(offersBefore.map(stable));
  });

  it('repeats a new-join fill quietly: the offer is known the second time and the product already has the EAN', async () => {
    await storedProduct({ slug: 'sin-ean', ...KEY });
    const feed = await aFeedOf('Tienda Beta');
    const rows = [keyRow('b-1', { ...KEY, ean: EAN.one })];
    await importRows({ [feed.feedId]: rows }, { feedId: feed.feedId });
    const productsBefore = await allProducts();

    const again = await importRows({ [feed.feedId]: rows }, { feedId: feed.feedId });

    expect(again.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1, eanFilled: 0 });
    expect(eanLines(again)).toEqual([]);
    expect(await allProducts()).toEqual(productsBefore);
  });

  it.each([
    ['the shop is not approved', { shopApproved: false }],
    ['the offer is hidden', { offerExtra: { isHidden: true } }],
    ['the product has another EAN', { ean: EAN.two }],
  ])('prints nothing on the first import or the repeat when %s, and the products are the same', async (_label, setup) => {
    const { feed } = await world(setup);
    const first = await importX(feed.feedId, { ean: EAN.one });
    const productsBefore = await allProducts();

    const again = await importX(feed.feedId, { ean: EAN.one });

    expect(eanLines(first)).toEqual([]);
    expect(eanLines(again)).toEqual([]);
    expect(await allProducts()).toEqual(productsBefore);
  });
});

describe('what the visitor and the admin see after a fill (AC 21, 22)', () => {
  /** Two shops on one public product: Alfa's offer stored, Beta's offer stored (known) or created by the import (join). */
  async function publicWorld(mode: 'known offer' | 'new join') {
    const [target] = await fiveTargets();
    const a = await aFeedOf('Tienda Alfa');
    const b = await aFeedOf('Tienda Beta');
    const product = await storedProduct({ slug: 'filtro-publico', ...KEY, extra: { categoryId: target.id } });
    await insertOffer({ productId: product.id, feedId: a.feedId, externalId: 'a-1', priceCents: 1050 });
    if (mode === 'known offer') await insertOffer({ productId: product.id, feedId: b.feedId, externalId: 'b-1', priceCents: 900 });
    const run = () => importRows({ [b.feedId]: [keyRow('b-1', { ...KEY, ean: EAN.one, price: '9.00' })] }, { feedId: b.feedId });
    return { product, target, run };
  }

  const search = (raw: string) => getPublicSearchPage(parseSearchTerm(raw), 1);
  const slugs = (result: Awaited<ReturnType<typeof search>>) =>
    result?.state === 'results' ? result.products.map((card) => card.slug) : [];
  const admin = (term: string) => listProductsForAdmin({ term, hiddenOnly: false, page: 1 });

  it.each(['known offer', 'new join'] as const)('AC 21 (%s): the product page, its structured data, public search and both admin readers show the EAN', async (mode) => {
    const { product, run } = await publicWorld(mode);
    // Before: no EAN anywhere, so every check below can fail.
    const pageBefore = await getPublicProductBySlug(product.slug);
    expect(pageBefore?.ean).toBeNull();
    expect(buildProductJsonLd(pageBefore!)).not.toHaveProperty('gtin');
    expect(await search(EAN.one)).toMatchObject({ state: 'no-results' });
    expect((await admin(EAN.one)).rows).toEqual([]);

    expect((await run()).feeds[0]).toMatchObject({ eanFilled: 1 });

    const page = await getPublicProductBySlug(product.slug);
    expect(page?.ean).toBe(EAN.one);
    expect(buildProductJsonLd(page!)).toMatchObject({ gtin: EAN.one });
    for (const term of [EAN.one, '2000 0000 00046', '2000-0000-00046', ` ${EAN.one} `]) {
      expect(slugs(await search(term))).toEqual([product.slug]);
    }
    const listed = await admin(EAN.one);
    expect(listed.rows.map((row) => [row.slug, row.ean])).toEqual([[product.slug, EAN.one]]);
    expect(await readProductForAdmin(product.id)).toMatchObject({ slug: product.slug, ean: EAN.one });
  });

  it('AC 22: the offers, prices, shop order, lowest price and shop count are the same before and after the fill, in integer cents', async () => {
    const { product, target, run } = await publicWorld('known offer');
    const shape = async () => {
      const page = await getPublicProductBySlug(product.slug);
      const listing = await getPublicCategoryPage(target.slug, 1, null, 'price-asc');
      const card = listing?.products.find((entry) => entry.slug === product.slug);
      return {
        offers: page?.offers.map((offer) => [offer.shopName, offer.priceCents, offer.isBestPrice]),
        card: { lowestPriceCents: card?.lowestPriceCents, offerCount: card?.offerCount },
      };
    };
    const before = await shape();
    expect(before.offers).toEqual([
      ['Tienda Beta', 900, true],
      ['Tienda Alfa', 1050, false],
    ]);

    expect((await run()).feeds[0]).toMatchObject({ eanFilled: 1 });

    expect(await shape()).toEqual(before);
    expect(before.card).toEqual({ lowestPriceCents: 900, offerCount: 2 });
    expect((await allOffers()).every((offer) => Number.isInteger(offer.priceCents))).toBe(true);
  });
});
