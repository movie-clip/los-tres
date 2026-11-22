import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { formatImportReport, importExitCode } from '@/server/importer';

import { allOffers, allProducts, insertCategoryMapping, insertOffer } from '../support/catalogue';
import { fiveTargets } from '../support/categories';
import { resetDatabase } from '../support/db';
import { callGo } from '../support/go';
import { EAN, MAPPED, aFeedOf, importRows, importText, keyRow, mapFeed, storedProduct } from '../support/matching';
import { stubNetworkOff } from '../support/network-off';

// S7.1 (US-7.1, T7.1.2): step 2 of 0008 end to end, through the real importer and the real public
// readers. ACs 1 to 12, 14, 15 and 20 to 24 live here; ACs 13 and 16 to 19 are in
// importer-matching.test.ts, AC 25 and 26 in matching-index.test.ts, AC 27 in unit/matching.test.ts.
// Rows are written with `keyRow` and `catalogueCsv` (they carry `part_number`); stored products
// that cause a conflict are set up through `storedProduct`, not through an import.

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

const KEY = { brand: 'MarcaUno', part: 'PN 100' };

/** The offers of each product, as [external id, ...] sorted, keyed by product id. */
async function offersByProduct(): Promise<Map<number, string[]>> {
  const byProduct = new Map<number, string[]>();
  for (const offer of await allOffers()) {
    byProduct.set(offer.productId, [...(byProduct.get(offer.productId) ?? []), offer.externalId].sort());
  }
  return byProduct;
}

describe('two shops, no EAN, one brand and part number converge (AC 1, 2)', () => {
  it('AC 1: one product with two offers, listed cheapest first, each with its own link', async () => {
    const a = await aFeedOf('Tienda Alfa');
    const b = await aFeedOf('Tienda Beta');
    await mapFeed(a.feedId);
    await mapFeed(b.feedId);

    const report = await importRows({
      [a.feedId]: [keyRow('a-1', { ...KEY, price: '10.50', url: 'https://tienda-a.example/p/1', category: MAPPED })],
      [b.feedId]: [keyRow('b-9', { ...KEY, price: '9.20', url: 'https://tienda-b.example/p/9', category: MAPPED })],
    });

    expect(report.feeds.map((feed) => [feed.productsCreated, feed.offersCreated, feed.rejected.length])).toEqual([
      [1, 1, 0],
      [0, 1, 0],
    ]);
    const rows = await allProducts();
    expect(rows).toHaveLength(1);
    expect(await allOffers()).toHaveLength(2);
    const page = await getPublicProductBySlug(rows[0].slug);
    expect(page?.offers.map((offer) => [offer.shopName, offer.priceCents])).toEqual([
      ['Tienda Beta', 920],
      ['Tienda Alfa', 1050],
    ]);
    const locations = [];
    for (const offer of page!.offers) locations.push((await callGo(offer.offerId)).headers.get('location'));
    expect(locations).toEqual(['https://tienda-b.example/p/9', 'https://tienda-a.example/p/1']);
  });

  it.each([
    ['the cheaper shop first in id order', ['Tienda Alfa', 'Tienda Beta']],
    ['the cheaper shop second in id order', ['Tienda Beta', 'Tienda Alfa']],
  ])('AC 2: the same result whichever feed is imported first (%s)', async (_label, order) => {
    const prices: Record<string, string> = { 'Tienda Alfa': '10.50', 'Tienda Beta': '9.20' };
    const byFeed: Record<number, ReturnType<typeof keyRow>[]> = {};
    for (const [index, shopName] of order.entries()) {
      const feed = await aFeedOf(shopName);
      await mapFeed(feed.feedId);
      byFeed[feed.feedId] = [keyRow(`row-${index}`, { ...KEY, price: prices[shopName], title: `Titulo de ${shopName}`, category: MAPPED })];
    }

    await importRows(byFeed);

    const rows = await allProducts();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe(`Titulo de ${order[0]}`); // the first feed's text stays
    const page = await getPublicProductBySlug(rows[0].slug);
    expect(page?.offers.map((offer) => [offer.shopName, offer.priceCents])).toEqual([
      ['Tienda Beta', 920],
      ['Tienda Alfa', 1050],
    ]);
  });
});

describe('what the existing normalisation removes does not matter (AC 3)', () => {
  it.each([
    ['part number spelling', { brand: 'MarcaUno', part: 'OC 12.34' }, { brand: 'MarcaUno', part: 'oc-1234' }],
    ['brand case and inner spaces', { brand: 'Marca Uno', part: 'PN 100' }, { brand: 'MARCA  UNO', part: 'PN 100' }],
    ['padding of both cells', { brand: 'MarcaUno', part: 'PN 100' }, { brand: '  marcauno  ', part: '  p.n-100 ' }],
  ])('converges rows that differ only in %s', async (_label, first, second) => {
    const a = await aFeedOf();
    const b = await aFeedOf();

    const report = await importRows({ [a.feedId]: [keyRow('x-1', first)], [b.feedId]: [keyRow('x-2', second)] });

    expect(report.feeds.map((feed) => [feed.productsCreated, feed.offersCreated, feed.rejected, feed.ownProducts])).toEqual([
      [1, 1, [], []],
      [0, 1, [], []],
    ]);
    expect(await allProducts()).toHaveLength(1);
    expect(await allOffers()).toHaveLength(2);
  });
});

describe('near misses stay their own product (AC 4 to 8)', () => {
  const near: [string, { brand?: string; part?: string }, { brand?: string; part?: string }][] = [
    ['AC 4: Bosch and Robert Bosch (no alias)', { brand: 'Bosch', part: 'F 026' }, { brand: 'Robert Bosch', part: 'F 026' }],
    ['AC 4: Mann-Filter and Mann Filter (hyphen is kept)', { brand: 'Mann-Filter', part: 'C 25' }, { brand: 'Mann Filter', part: 'C 25' }],
    ['AC 5: same part number, different brand', { brand: 'MarcaUno', part: 'PN 100' }, { brand: 'MarcaDos', part: 'PN 100' }],
    ['AC 6: same brand, different part number', { brand: 'MarcaUno', part: 'PN 100' }, { brand: 'MarcaUno', part: 'PN 101' }],
  ];

  it.each(near)('%s: two products, two offers, nothing rejected, nothing reported', async (_label, first, second) => {
    const a = await aFeedOf();
    const b = await aFeedOf();

    const report = await importRows({ [a.feedId]: [keyRow('x-1', first)], [b.feedId]: [keyRow('x-2', second)] });

    expect(report.feeds.map((feed) => [feed.productsCreated, feed.offersCreated, feed.rejected, feed.ownProducts])).toEqual([
      [1, 1, [], []],
      [1, 1, [], []],
    ]);
    expect(await allProducts()).toHaveLength(2);
  });

  describe('a row with no brand (AC 7)', () => {
    it.each([
      ['an empty cell', ''],
      ['a blank cell', '   '],
    ])('with %s is its own product and attaches to none of the products holding its part number', async (_label, blank) => {
      const withBrand = await storedProduct({ slug: 'con-marca', brand: 'MarcaUno', part: 'PN 100' });
      const withoutBrand = await storedProduct({ slug: 'sin-marca', brand: null, part: 'PN 100' });
      const feed = await aFeedOf();

      const report = await importRows({ [feed.feedId]: [keyRow('x-1', { brand: blank, part: 'PN 100' })] });

      expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 1, offersCreated: 1, rejected: [], ownProducts: [] });
      const byProduct = await offersByProduct();
      expect(byProduct.has(withBrand.id)).toBe(false);
      expect(byProduct.has(withoutBrand.id)).toBe(false);
      expect(await allProducts()).toHaveLength(3);
    });

    it('two brandless rows with one part number do not converge, in two feeds or in one', async () => {
      const a = await aFeedOf();
      const b = await aFeedOf();

      await importRows({
        [a.feedId]: [keyRow('x-1', { part: 'PN 100' }), keyRow('x-2', { part: 'PN 100' })],
        [b.feedId]: [keyRow('x-3', { part: 'PN 100' })],
      });

      expect(await allProducts()).toHaveLength(3);
    });
  });

  describe('a row with no part number (AC 8)', () => {
    it.each([
      ['an empty cell', ''],
      ['a blank cell', '   '],
      ['a cell of separators only', ' .- '],
    ])('with %s is its own product and attaches to none of the products of its brand', async (_label, blank) => {
      const withPart = await storedProduct({ slug: 'con-pieza', brand: 'MarcaUno', part: 'PN 100' });
      const withoutPart = await storedProduct({ slug: 'sin-pieza', brand: 'MarcaUno', part: null });
      const feed = await aFeedOf();

      const report = await importRows({ [feed.feedId]: [keyRow('x-1', { brand: 'MarcaUno', part: blank })] });

      expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 1, offersCreated: 1, rejected: [], ownProducts: [] });
      const byProduct = await offersByProduct();
      expect(byProduct.has(withPart.id)).toBe(false);
      expect(byProduct.has(withoutPart.id)).toBe(false);
      expect(await allProducts()).toHaveLength(3);
    });

    it('two rows of one brand with no part number do not converge', async () => {
      const feed = await aFeedOf();
      await importRows({ [feed.feedId]: [keyRow('x-1', { brand: 'MarcaUno' }), keyRow('x-2', { brand: 'MarcaUno' })] });
      expect(await allProducts()).toHaveLength(2);
    });
  });
});

describe('a stored product with empty normalised values is never found (AC 9)', () => {
  // Raw brand and part number are the row's own; only the normalised column is stale, empty or null.
  it.each([
    ['a null normalised brand', { brandNormalised: null }],
    ['an empty normalised brand', { brandNormalised: '' }],
    ['a null normalised part number', { partNumberNormalised: null }],
    ['an empty normalised part number', { partNumberNormalised: '' }],
    ['both normalised values null', { brandNormalised: null, partNumberNormalised: null }],
  ])('with %s the row is its own product, nothing fails and the stored product gets no offer', async (_label, stale) => {
    const stored = await storedProduct({ slug: 'antiguo', brand: 'MarcaUno', part: 'PN 100', extra: stale });
    const feed = await aFeedOf();

    const report = await importRows({ [feed.feedId]: [keyRow('x-1', KEY)] });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 1, offersCreated: 1, rejected: [], ownProducts: [] });
    expect(importExitCode(report)).toBe(0);
    expect((await offersByProduct()).has(stored.id)).toBe(false);
    expect(await allProducts()).toHaveLength(2);
  });
});

describe('a convergence changes no product text (AC 10)', () => {
  const HEADER = 'id,title,brand,part_number,ean,price,currency,url,description';
  const csv = (row: string) => [HEADER, row, ''].join('\n');

  it('leaves the stored row identical in every column, whatever the second feed says', async () => {
    const a = await aFeedOf();
    const b = await aFeedOf();
    await importText(
      {
        [a.feedId]: csv('x-1,Titulo de la primera tienda,Marca Uno,PN 100,,10.00,EUR,https://tienda-a.example/p/1,Descripcion primera'),
      },
      { feedId: a.feedId },
    );
    const before = await allProducts();

    // The second shop writes a different title, spelling, description and an EAN; the key still matches.
    const report = await importText(
      {
        [b.feedId]: csv(`x-2,Otro titulo muy distinto,MARCA  UNO,pn-100,${EAN.one},9.00,EUR,https://tienda-b.example/p/2,Otra descripcion`),
      },
      { feedId: b.feedId },
    );

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [] });
    expect(await allProducts()).toEqual(before);
    expect(before[0]).toMatchObject({
      title: 'Titulo de la primera tienda',
      brand: 'Marca Uno',
      partNumber: 'PN 100',
      ean: null,
      description: 'Descripcion primera',
    });
  });
});

describe('two rows of one feed converge (AC 11)', () => {
  it('attaches the second row to the product the first created in the same import', async () => {
    const feed = await aFeedOf();

    const report = await importRows({
      [feed.feedId]: [keyRow('x-1', { ...KEY, price: '5.00' }), keyRow('x-2', { ...KEY, price: '5.50' })],
    });

    expect(report.feeds[0]).toMatchObject({ rows: 2, productsCreated: 1, offersCreated: 2, rejected: [], ownProducts: [] });
    const rows = await allProducts();
    expect(rows).toHaveLength(1);
    expect((await offersByProduct()).get(rows[0].id)).toEqual(['x-1', 'x-2']);
  });
});

describe('the EAN comes first (AC 12)', () => {
  it.each([
    ['the same brand', 'MarcaUno'],
    ['no brand at all', null],
  ])('attaches to the EAN holder with %s, whatever the brand and part number say; the key holder gets nothing', async (_label, holderBrand) => {
    const holder = await storedProduct({ slug: 'titular-ean', brand: holderBrand, part: 'PN 100', ean: EAN.one });
    const keyHolder = await storedProduct({ slug: 'titular-clave', brand: 'MarcaUno', part: 'PN 200' });
    const feed = await aFeedOf();

    const report = await importRows({ [feed.feedId]: [keyRow('x-1', { brand: 'MarcaUno', part: 'PN 200', ean: EAN.one })] });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, rejected: [], ownProducts: [] });
    const byProduct = await offersByProduct();
    expect(byProduct.get(holder.id)).toEqual(['x-1']);
    expect(byProduct.has(keyHolder.id)).toBe(false);
  });
});

describe('an EAN on one side only (AC 14)', () => {
  it('a row without an EAN converges on the product that has one, and the product keeps it', async () => {
    const a = await aFeedOf();
    const b = await aFeedOf();
    await importRows({ [a.feedId]: [keyRow('x-1', { ...KEY, ean: EAN.one })] }, { feedId: a.feedId });
    const before = await allProducts();

    const report = await importRows({ [b.feedId]: [keyRow('x-2', KEY)] }, { feedId: b.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, rejected: [], ownProducts: [] });
    expect(await allProducts()).toEqual(before);
    expect(before[0].eanNormalised).toBe(EAN.one);
    expect(await allOffers()).toHaveLength(2);
  });

  it('a row with a valid EAN no product holds converges on the key holder that has none', async () => {
    const a = await aFeedOf();
    const b = await aFeedOf();
    await importRows({ [a.feedId]: [keyRow('x-1', KEY)] }, { feedId: a.feedId });
    const before = await allProducts();

    const report = await importRows({ [b.feedId]: [keyRow('x-2', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, rejected: [], ownProducts: [] });
    expect(await allOffers()).toHaveLength(2);
    // Product text is written once (AC 10): the attached offer's EAN does not reach the product.
    expect(await allProducts()).toEqual(before);
    expect(before[0].ean).toBeNull();
    expect(before[0].eanNormalised).toBeNull();
  });

  it('a later row with that EAN and the same key reaches the same product, through the key', async () => {
    const a = await aFeedOf();
    const b = await aFeedOf();
    const c = await aFeedOf();
    await importRows({ [a.feedId]: [keyRow('x-1', KEY)] }, { feedId: a.feedId });
    await importRows({ [b.feedId]: [keyRow('x-2', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });

    const report = await importRows({ [c.feedId]: [keyRow('x-3', { ...KEY, ean: EAN.one })] }, { feedId: c.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [] });
    expect(await allProducts()).toHaveLength(1);
    expect(await allOffers()).toHaveLength(3);
  });
});

describe('two different EANs on one key (AC 15)', () => {
  it.each([
    ['the EAN-bearing shop first', [EAN.one, EAN.two]],
    ['the other EAN first', [EAN.two, EAN.one]],
  ])('keeps the second row its own product, whichever EAN came first (%s)', async (_label, [firstEan, secondEan]) => {
    const a = await aFeedOf();
    const b = await aFeedOf();
    await importRows({ [a.feedId]: [keyRow('x-1', { ...KEY, ean: firstEan })] }, { feedId: a.feedId });
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();

    const report = await importRows({ [b.feedId]: [keyRow('x-2', { ...KEY, ean: secondEan })] }, { feedId: b.feedId });

    expect(report.feeds[0]).toMatchObject({
      productsCreated: 1,
      offersCreated: 1,
      rejected: [],
      ownProducts: [{ record: 2, reason: 'brand_part_number_ean_conflict' }],
    });
    const productsAfter = await allProducts();
    expect(productsAfter).toHaveLength(2);
    expect(productsAfter.slice(0, 1)).toEqual(productsBefore);
    expect((await allOffers()).slice(0, 1)).toEqual(offersBefore);
  });

  it('control: the same EAN on the same key attaches, so the conflict is about the EANs differing', async () => {
    const a = await aFeedOf();
    const b = await aFeedOf();
    await importRows({ [a.feedId]: [keyRow('x-1', { ...KEY, ean: EAN.one })] }, { feedId: a.feedId });

    const report = await importRows({ [b.feedId]: [keyRow('x-2', { ...KEY, ean: EAN.one })] }, { feedId: b.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, ownProducts: [] });
    expect(await allProducts()).toHaveLength(1);
  });
});

describe('a key held by two products converges on none (AC 20)', () => {
  it.each([
    ['without an EAN', undefined],
    ['with an EAN no product holds', EAN.three],
  ])('makes a row %s its own product and gives neither holder an offer', async (_label, ean) => {
    const first = await storedProduct({ slug: 'gemelo-1', ...KEY });
    const second = await storedProduct({ slug: 'gemelo-2', ...KEY });
    const holdersBefore = await allProducts();
    const feed = await aFeedOf();

    const report = await importRows({ [feed.feedId]: [keyRow('x-1', { ...KEY, ean })] });

    expect(report.feeds[0]).toMatchObject({
      outcome: 'imported',
      productsCreated: 1,
      offersCreated: 1,
      rejected: [],
      ownProducts: [{ record: 2, reason: 'ambiguous_brand_part_number' }],
    });
    const byProduct = await offersByProduct();
    expect(byProduct.has(first.id)).toBe(false);
    expect(byProduct.has(second.id)).toBe(false);
    const after = await allProducts();
    expect(after).toHaveLength(3);
    expect(after.slice(0, 2)).toEqual(holdersBefore);
  });
});

describe('a repeat import and what is already stored (AC 21, 22)', () => {
  it('AC 21: a second import changes only prices and dates; own-product rows stay attached and are not listed again', async () => {
    // Stored beforehand: a key holder to converge on, an EAN holder of another brand, two EAN twins,
    // two key twins and a key holder carrying another EAN. Rows 2 to 6 of the feed meet them in turn.
    await storedProduct({ slug: 'converge', brand: 'MarcaUno', part: 'PN 1' });
    await storedProduct({ slug: 'titular-ean', brand: 'MarcaDos', part: 'PN 2', ean: EAN.one });
    await storedProduct({ slug: 'gemelo-ean-1', ean: EAN.two });
    await storedProduct({ slug: 'gemelo-ean-2', ean: EAN.two });
    await storedProduct({ slug: 'gemelo-clave-1', brand: 'MarcaTres', part: 'PN 3' });
    await storedProduct({ slug: 'gemelo-clave-2', brand: 'MarcaTres', part: 'PN 3' });
    await storedProduct({ slug: 'titular-clave', brand: 'MarcaCuatro', part: 'PN 4', ean: EAN.three });
    const feed = await aFeedOf();
    const rows = (price: string) => [
      keyRow('r-1', { brand: 'MarcaUno', part: 'PN 1', price }),
      keyRow('r-2', { brand: 'MarcaOtra', part: 'PN 9', ean: EAN.one, price }),
      keyRow('r-3', { brand: 'MarcaOtra', part: 'PN 8', ean: EAN.two, price }),
      keyRow('r-4', { brand: 'MarcaTres', part: 'PN 3', price }),
      keyRow('r-5', { brand: 'MarcaCuatro', part: 'PN 4', ean: EAN.four, price }),
    ];

    const first = await importRows({ [feed.feedId]: rows('10.00') });
    expect(first.feeds[0]).toMatchObject({ productsCreated: 4, offersCreated: 5, rejected: [] });
    expect(first.feeds[0].ownProducts.map((own) => own.reason)).toEqual([
      'ean_brand_conflict',
      'ambiguous_ean',
      'ambiguous_brand_part_number',
      'brand_part_number_ean_conflict',
    ]);
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();

    const second = await importRows({ [feed.feedId]: rows('12.50') });

    expect(second.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 5, rejected: [], ownProducts: [] });
    expect(formatImportReport(second)).not.toContain('own_product');
    expect(await allProducts()).toEqual(productsBefore);
    const offersAfter = await allOffers();
    expect(offersAfter.map((offer) => [offer.id, offer.productId, offer.feedId, offer.externalId])).toEqual(
      offersBefore.map((offer) => [offer.id, offer.productId, offer.feedId, offer.externalId]),
    );
    expect(offersAfter.every((offer) => offer.priceCents === 1250)).toBe(true);
  });

  it('AC 22: two products stored apart stay apart and each offer keeps its product after an import', async () => {
    const first = await storedProduct({ slug: 'separado-1', ...KEY });
    const second = await storedProduct({ slug: 'separado-2', ...KEY });
    const feed = await aFeedOf();
    await insertOffer({ productId: first.id, feedId: feed.feedId, externalId: 'x-1', priceCents: 1000 });
    await insertOffer({ productId: second.id, feedId: feed.feedId, externalId: 'x-2', priceCents: 1100 });

    // The feed now serves the same two ids with the same key; a known offer is updated in place.
    const report = await importRows({
      [feed.feedId]: [keyRow('x-1', { ...KEY, price: '9.00' }), keyRow('x-2', { ...KEY, price: '9.50' })],
    });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 2, ownProducts: [] });
    expect(await allProducts()).toHaveLength(2);
    const byProduct = await offersByProduct();
    expect(byProduct.get(first.id)).toEqual(['x-1']);
    expect(byProduct.get(second.id)).toEqual(['x-2']);
  });
});

describe('visibility is not changed by matching (AC 23, 24; guardrail 1)', () => {
  it('AC 23: a row whose key matches a hidden product attaches to it; the product stays hidden and not public', async () => {
    const a = await aFeedOf('Tienda Alfa');
    const b = await aFeedOf('Tienda Beta');
    await mapFeed(a.feedId);
    await mapFeed(b.feedId);
    await importRows({ [a.feedId]: [keyRow('x-1', { ...KEY, category: MAPPED })] }, { feedId: a.feedId });
    const bystander = await storedProduct({ slug: 'otro-producto', brand: 'MarcaDos', part: 'PN 7' });
    const [hidden] = await allProducts();
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, hidden.id));
    const before = await allProducts();

    const report = await importRows({ [b.feedId]: [keyRow('x-2', { ...KEY, category: MAPPED })] }, { feedId: b.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [] });
    expect(await allProducts()).toEqual(before); // still hidden, nothing else touched
    expect((await offersByProduct()).get(hidden.id)).toEqual(['x-1', 'x-2']);
    expect(await getPublicProductBySlug(hidden.slug)).toBeNull();
    expect(before.find((row) => row.id === bystander.id)?.isHidden).toBe(false);
  });

  describe('AC 24: a converged page lists only the offers that are public', () => {
    /** Three shops on one product, all imported while approved, then one change at a time. */
    async function threeShops() {
      const feedsOf = [await aFeedOf('Tienda Alfa'), await aFeedOf('Tienda Beta'), await aFeedOf('Tienda Gamma')];
      const prices = ['10.00', '9.00', '11.00'];
      const byFeed: Record<number, ReturnType<typeof keyRow>[]> = {};
      let target = null;
      for (const [index, feed] of feedsOf.entries()) {
        target = await mapFeed(feed.feedId);
        byFeed[feed.feedId] = [keyRow(`s-${index}`, { ...KEY, price: prices[index], category: MAPPED })];
      }
      await importRows(byFeed);
      const [product] = await allProducts();
      expect(await allProducts()).toHaveLength(1);
      return { feedsOf, product, target: target! };
    }

    it('drops the offer of an unapproved feed and the hidden offer, and computes the lowest price and shop count without them', async () => {
      const { feedsOf, product, target } = await threeShops();
      const [, beta, gamma] = feedsOf;
      expect((await getPublicProductBySlug(product.slug))?.offers.map((offer) => offer.shopName)).toEqual([
        'Tienda Beta',
        'Tienda Alfa',
        'Tienda Gamma',
      ]);

      await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, beta.feedId)); // the cheapest, out by its feed
      await getDb().update(offers).set({ isHidden: true }).where(eq(offers.feedId, gamma.feedId)); // the dearest, hidden

      const page = await getPublicProductBySlug(product.slug);
      expect(page?.offers.map((offer) => [offer.shopName, offer.priceCents])).toEqual([['Tienda Alfa', 1000]]);
      const listing = await getPublicCategoryPage(target.slug, 1, null, 'price-asc');
      const card = listing?.products.find((entry) => entry.slug === product.slug);
      expect(card).toMatchObject({ lowestPriceCents: 1000, offerCount: 1 });
    });

    it('also drops the offer of an unapproved shop', async () => {
      const { feedsOf, product } = await threeShops();
      await getDb().update(shops).set({ isApproved: false }).where(eq(shops.id, feedsOf[1].shopId));

      const page = await getPublicProductBySlug(product.slug);
      expect(page?.offers.map((offer) => offer.shopName)).toEqual(['Tienda Alfa', 'Tienda Gamma']);
    });

    it('is not found when none of its offers is public', async () => {
      const { product } = await threeShops();
      await getDb().update(offers).set({ isHidden: true });
      expect(await getPublicProductBySlug(product.slug)).toBeNull();
    });

    it('assigns no category beyond the first mapped one', async () => {
      const [first, second] = [await aFeedOf('Tienda Alfa'), await aFeedOf('Tienda Beta')];
      const targets = await fiveTargets();
      await insertCategoryMapping(first.feedId, MAPPED, targets[0].id);
      await insertCategoryMapping(second.feedId, MAPPED, targets[1].id);

      await importRows({
        [first.feedId]: [keyRow('x-1', { ...KEY, category: MAPPED })],
        [second.feedId]: [keyRow('x-2', { ...KEY, category: MAPPED })],
      });

      const rows = await allProducts();
      expect(rows).toHaveLength(1);
      expect(rows[0].categoryId).toBe(targets[0].id);
    });

    it('sets no flag: a converged offer of an unapproved shop stays out of the page, and nothing is approved or hidden for it', async () => {
      const a = await aFeedOf('Tienda Alfa');
      const b = await aFeedOf('Tienda Beta', { shopApproved: false });
      await mapFeed(a.feedId);
      await mapFeed(b.feedId);

      await importRows({
        [a.feedId]: [keyRow('x-1', { ...KEY, price: '10.00', category: MAPPED })],
        [b.feedId]: [keyRow('x-2', { ...KEY, price: '8.00', category: MAPPED })],
      });

      const rows = await allProducts();
      expect(rows).toHaveLength(1);
      expect((await allOffers()).find((offer) => offer.externalId === 'x-2')).toMatchObject({ isHidden: false, inReview: false });
      const [shopB] = await getDb().select({ approved: shops.isApproved }).from(shops).where(eq(shops.id, b.shopId));
      expect(shopB.approved).toBe(false);
      const page = await getPublicProductBySlug(rows[0].slug);
      expect(page?.offers.map((offer) => [offer.shopName, offer.priceCents])).toEqual([['Tienda Alfa', 1000]]);
    });
  });
});
