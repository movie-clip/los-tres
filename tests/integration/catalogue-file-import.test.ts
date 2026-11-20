import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { eq, getTableColumns } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { clicks, feeds, products, shops } from '@/db/schema';
import { assignCategory, listCategoryMappingsForAdmin } from '@/server/admin/category-mappings';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { formatEuroCents } from '@/server/money';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';
import { readFeedSource } from '@/server/importer/source';
import { updateFeed } from '@/server/admin/sources';

import { allOffers, allProducts, insertCategoryMapping, insertFeed, insertShop } from '../support/catalogue';
import { aFileFeed, catalogueCsv, importFromFolder, insertFileFeed, tempCatalogueFolder } from '../support/catalogue-files';
import { ABSENT_VIEW, PUBLIC_VIEW, categoryForm, fiveTargets, publicView } from '../support/categories';
import { resetDatabase } from '../support/db';
import { allClicks, callGo } from '../support/go';
import { normaliseSpaces } from '../support/messages';
import { stubNetworkOff } from '../support/network-off';

// S3.7 T3.7.4. What the build lanes' own tests (catalogue-file-source.test.ts,
// admin-source-writers.test.ts) leave open: the import cases of ACs 18, 21 to 25, the prices and
// links of ACs 26 and 27, the categories of ACs 28 and 29, the approvals of ACs 15 to 17 against
// the public readers, two shops on one product (AC 30) and the demo isolation of AC 35.
// Every file is written into a TEMP folder and read through `catalogueDir`; the repo's
// catalogue-files/ is never touched. Shops, products, files and links are invented.

let folder: Awaited<ReturnType<typeof tempCatalogueFolder>>;
let dir: string;

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
  folder = await tempCatalogueFolder();
  dir = folder.dir;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await folder.remove();
});
afterAll(async () => {
  await closeDb();
});

const write = (name: string, content: string) => writeFile(path.join(dir, name), content);

const ROW_A = { id: 'cf-1', title: 'Filtro Catalogo Prueba Uno', price: '12,99', url: 'https://tienda-uno.example/p/cf-1?ref=a&x=1', brand: 'MarcaCf', ean: '4006381333931', currency: 'EUR', category: 'Filtros de prueba' };
const ROW_B = { id: 'cf-2', title: 'Aceite Catalogo Prueba Dos', price: '7.25', url: 'https://tienda-uno.example/p/cf-2', brand: 'MarcaCf', ean: '', currency: 'EUR', category: 'Aceites de prueba' };

async function productSlugs(): Promise<string[]> {
  return (await allProducts()).map((product) => product.slug);
}

describe('the report of a file feed (AC 18)', () => {
  it('prints the usual imported line with the shop name and the counts, and exit code 0', async () => {
    await write('uno.csv', catalogueCsv([ROW_A, ROW_B]));
    const { feedId } = await aFileFeed('uno.csv', { shopName: 'Tienda Informe Uno' });

    const report = await importFromFolder(dir);
    const text = formatImportReport(report);

    expect(text).toContain(
      `feed ${feedId} "Tienda Informe Uno": imported rows=2 products_created=2 offers_created=2 offers_updated=0 rejected=0`,
    );
    expect(text).toContain('total: feeds=1 imported=1 skipped=0 failed=0');
    expect(importExitCode(report)).toBe(0);
  });
});

describe('one failed file feed does not stop the others, and the exit code is 1 (AC 21, 23)', () => {
  it('reports a planted traversal name, a missing file and a good file in one run', async () => {
    await write('bueno.csv', catalogueCsv([ROW_A]));
    const planted = await aFileFeed('../planted.csv', { shopName: 'Tienda Plantada' });
    const missing = await aFileFeed('falta.csv', { shopName: 'Tienda Sin Archivo' });
    const good = await aFileFeed('bueno.csv', { shopName: 'Tienda Buena' });

    const report = await importFromFolder(dir);
    const text = formatImportReport(report);

    expect(report.feeds.map((feed) => [feed.feedId, feed.outcome, feed.failure ?? null])).toEqual([
      [planted.feedId, 'failed', 'file_name_refused'],
      [missing.feedId, 'failed', 'file_not_found'],
      [good.feedId, 'imported', null],
    ]);
    expect(text).toContain('total: feeds=3 imported=1 skipped=0 failed=2');
    expect(importExitCode(report)).toBe(1);
    expect(await allOffers()).toHaveLength(1);
    for (const needle of ['planted.csv', 'falta.csv', 'bueno.csv', dir]) expect(text).not.toContain(needle);
  });

  it('a missing folder fails the file feed and still lets another kind of feed run first', async () => {
    const shop = await insertShop();
    await insertFileFeed(shop.id, 'x.csv');
    const gone = path.join(dir, 'never-made');

    const report = await importFeeds(getDb(), { deps: { readSource: (feed) => readFeedSource(feed, { catalogueDir: gone }) } });

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_not_found' });
    expect(importExitCode(report)).toBe(1);
  });
});

describe('the importer keeps its validation for a catalogue file (AC 24)', () => {
  it('rejects each bad row by record number and field, imports the rest, and exits 0', async () => {
    await write(
      'mezcla.csv',
      catalogueCsv([
        ROW_A,
        { ...ROW_B, id: '', title: 'Sin identificador' },
        { ...ROW_B, id: 'cf-3', title: '' },
        { ...ROW_B, id: 'cf-4', price: '1.299,00' },
        { ...ROW_B, id: 'cf-5', currency: 'USD' },
        { ...ROW_B, id: 'cf-6', ean: '1234567890123' },
        { ...ROW_B, id: 'cf-7', url: 'ftp://tienda-uno.example/p/cf-7' },
        { ...ROW_B, id: 'cf-8', url: 'javascript:alert(1)' },
        { ...ROW_B, id: 'cf-9' },
      ]),
    );
    await aFileFeed('mezcla.csv');

    const report = await importFromFolder(dir);
    const [feed] = report.feeds;

    expect(feed).toMatchObject({ outcome: 'imported', rows: 9, offersCreated: 2 });
    // Record 1 is the header, so data row n is record n + 1.
    expect(feed.rejected.map((row) => [row.record, row.field])).toEqual([
      [3, 'id'],
      [4, 'title'],
      [5, 'price'],
      [6, 'currency'],
      [7, 'ean'],
      [8, 'url'],
      [9, 'url'],
    ]);
    expect(importExitCode(report)).toBe(0);
    expect(await allOffers()).toHaveLength(2);
  });

  it('fails the feed on a missing required column and lets the next feed import', async () => {
    await write('sin-precio.csv', 'id,title,url\ncf-1,Filtro sin precio,https://tienda-uno.example/p/1\n');
    await write('bueno.csv', catalogueCsv([ROW_B]));
    const broken = await aFileFeed('sin-precio.csv');
    const good = await aFileFeed('bueno.csv');

    const report = await importFromFolder(dir);

    expect(report.feeds.find((feed) => feed.feedId === broken.feedId)).toMatchObject({ outcome: 'failed', failure: 'invalid_header' });
    expect(report.feeds.find((feed) => feed.feedId === good.feedId)).toMatchObject({ outcome: 'imported', offersCreated: 1 });
    expect(importExitCode(report)).toBe(1);
  });
});

describe('running the import again on an unchanged file (AC 25)', () => {
  it('creates no product and no offer and changes only prices and dates', async () => {
    await write('otra-vez.csv', catalogueCsv([ROW_A, ROW_B]));
    const { feedId } = await aFileFeed('otra-vez.csv');
    await importFromFolder(dir);
    const before = { products: await allProducts(), offers: await allOffers() };

    const second = await importFromFolder(dir, { feedId });

    expect(second.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 0, offersCreated: 0 });
    const after = { products: await allProducts(), offers: await allOffers() };
    expect(after.products).toEqual(before.products);
    expect(after.offers.map((offer) => ({ ...offer, priceUpdatedAt: null }))).toEqual(
      before.offers.map((offer) => ({ ...offer, priceUpdatedAt: null })),
    );
  });

  it('updates a price that changed in the file and nothing else', async () => {
    await write('precio.csv', catalogueCsv([ROW_A]));
    const { feedId } = await aFileFeed('precio.csv');
    await importFromFolder(dir);
    await write('precio.csv', catalogueCsv([{ ...ROW_A, price: '11,50' }]));

    const report = await importFromFolder(dir, { feedId });

    expect(report.feeds[0]).toMatchObject({ offersCreated: 0, offersUpdated: 1 });
    expect((await allOffers())[0].priceCents).toBe(1150);
    expect(await allProducts()).toHaveLength(1);
  });
});

describe('prices are read as IVA-included decimal text and stored as integer cents (AC 26)', () => {
  it.each([
    ['12,99', 1299],
    ['12.99', 1299],
    ['7', 700],
    ['0,5', 50],
    ['0.05', 5],
    ['19.9', 1990],
    ['1234,50', 123450],
  ])('stores %s as %i cents and shows it in euros', async (text, cents) => {
    await write('precios.csv', catalogueCsv([{ ...ROW_B, price: text }]));
    await aFileFeed('precios.csv');

    await importFromFolder(dir);

    const [offer] = await allOffers();
    expect(offer.priceCents).toBe(cents);
    expect(Number.isInteger(offer.priceCents)).toBe(true);
    const [product] = await allProducts();
    await getDb().update(products).set({ categoryId: (await fiveTargets())[0].id }).where(eq(products.id, product.id));
    const page = await getPublicProductBySlug(product.slug);
    expect(page?.offers[0].priceCents).toBe(cents);
    expect(normaliseSpaces(formatEuroCents(page!.offers[0].priceCents))).toMatch(/^\d{1,3}(\.\d{3})*,\d{2} €$/);
  });

  it('shows 12,99 in the file as 12,99 €', () => {
    expect(normaliseSpaces(formatEuroCents(1299))).toBe('12,99 €');
  });

  it.each(['12,999', '12.999', '1.299,00', '1,299.00', '0', '0,00', '-5', '+5', '1e3', '1,2,3', '12 €', 'gratis', ''])(
    'rejects the price %j and never rounds it',
    async (text) => {
      await write('malos.csv', catalogueCsv([ROW_A, { ...ROW_B, price: text }]));
      await aFileFeed('malos.csv');

      const report = await importFromFolder(dir);

      expect(report.feeds[0].rejected.map((row) => [row.record, row.field])).toEqual([[3, 'price']]);
      expect(await allOffers()).toHaveLength(1);
    },
  );

  it('rejects a currency other than EUR', async () => {
    await write('divisa.csv', catalogueCsv([{ ...ROW_B, currency: 'GBP' }]));
    await aFileFeed('divisa.csv');

    const report = await importFromFolder(dir);

    expect(report.feeds[0].rejected.map((row) => row.field)).toEqual(['currency']);
    expect(await allOffers()).toEqual([]);
  });
});

describe('/go/<offer> sends the visitor to the link written in the file and counts the click (AC 27)', () => {
  async function importedOffer() {
    await write('go.csv', catalogueCsv([ROW_A]));
    const { feedId, shopId } = await aFileFeed('go.csv');
    await importFromFolder(dir);
    const [offer] = await allOffers();
    const [target] = await fiveTargets();
    await insertCategoryMapping(feedId, ROW_A.category, target.id);
    await getDb().update(products).set({ categoryId: target.id }).where(eq(products.id, offer.productId));
    return { offer, shopId, feedId };
  }

  it('redirects to exactly the address of the url column, nothing appended', async () => {
    const { offer } = await importedOffer();

    const response = await callGo(offer.id);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(ROW_A.url);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('logs one click with the existing fields only, because the feed is not a demo feed', async () => {
    const { offer, shopId } = await importedOffer();

    await callGo(offer.id);

    const rows = await allClicks();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ offerId: offer.id, shopId, productId: offer.productId });
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(getTableColumns(clicks)).sort());
  });

  it('answers 404 and counts nothing while the feed is unapproved', async () => {
    const { offer, feedId } = await importedOffer();
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, feedId));

    const response = await callGo(offer.id);

    expect(response.status).toBe(404);
    expect(await allClicks()).toEqual([]);
  });
});

describe('categories of a file feed (AC 28, 29)', () => {
  it('stores a row with no category or an unmapped one, public nowhere', async () => {
    await write('cat.csv', catalogueCsv([ROW_A, { ...ROW_B, category: '' }]));
    const { feedId } = await aFileFeed('cat.csv');

    await importFromFolder(dir);

    expect(await allProducts()).toHaveLength(2);
    expect((await allProducts()).map((product) => product.categoryId)).toEqual([null, null]);
    for (const target of await fiveTargets()) {
      expect(await publicView({ productSlug: (await productSlugs())[0], offerId: (await allOffers())[0].id, categorySlug: target.slug })).toEqual(ABSENT_VIEW);
    }
    const listed = (await listCategoryMappingsForAdmin()).feeds.find((feed) => feed.id === feedId)!;
    expect(listed.rows.map((row) => [row.feedCategory, row.productCount, row.state.kind])).toEqual([[ROW_A.category, 1, 'not_reviewed']]);
  });

  it('lists each distinct category as not reviewed, then publishes after a mapping with no second import', async () => {
    await write('map.csv', catalogueCsv([ROW_A, { ...ROW_B, category: ROW_A.category }, { ...ROW_B, id: 'cf-3', title: 'Aceite Catalogo Tres', category: 'Aceites de prueba' }]));
    const { feedId } = await aFileFeed('map.csv', { feedApproved: true });
    await importFromFolder(dir);
    const [target] = await fiveTargets();
    const listed = async () => (await listCategoryMappingsForAdmin()).feeds.find((feed) => feed.id === feedId)!;

    expect((await listed()).rows.map((row) => [row.feedCategory, row.productCount, row.state.kind])).toEqual([
      [ROW_A.category, 2, 'not_reviewed'],
      ['Aceites de prueba', 1, 'not_reviewed'],
    ]);
    const [first] = await allProducts();
    const offerId = (await allOffers()).find((offer) => offer.productId === first.id)!.id;
    expect(await publicView({ productSlug: first.slug, offerId, categorySlug: target.slug })).toEqual(ABSENT_VIEW);

    const result = await assignCategory(categoryForm({ feedId, feedCategory: ROW_A.category, target: target.id }));

    expect(result.status).toBe('saved');
    expect(await publicView({ productSlug: first.slug, offerId, categorySlug: target.slug })).toMatchObject({
      categoryCount: 2,
      productPage: true,
      sitemapProduct: true,
      sitemapCategory: true,
      go: 302,
    });
    expect((await listed()).rows.find((row) => row.feedCategory === ROW_A.category)?.state.kind).toBe('mapped');
  });

  it('shows the feed on the category screen by its file name, as a file feed', async () => {
    await write('pantalla.csv', catalogueCsv([ROW_A]));
    const { feedId } = await aFileFeed('pantalla.csv');
    await importFromFolder(dir);

    const listed = (await listCategoryMappingsForAdmin()).feeds.find((feed) => feed.id === feedId)!;

    expect(listed).toMatchObject({ source: 'catalogue_file', fileName: 'pantalla.csv', host: null, networkName: null });
  });
});

describe('two approvals, and nothing public before both (AC 15 to 17, 42)', () => {
  async function mappedImport() {
    await write('dos.csv', catalogueCsv([ROW_A]));
    const file = await aFileFeed('dos.csv', { shopApproved: false, feedApproved: false });
    // The feed is approved just for the import: an unapproved feed is never read.
    await getDb().update(feeds).set({ isApproved: true }).where(eq(feeds.id, file.feedId));
    await importFromFolder(dir);
    const [target] = await fiveTargets();
    await assignCategory(categoryForm({ feedId: file.feedId, feedCategory: ROW_A.category, target: target.id }));
    const [product] = await allProducts();
    const [offer] = await allOffers();
    return { ...file, target, view: { productSlug: product.slug, offerId: offer.id, categorySlug: target.slug } };
  }
  const setApproval = async (feedId: number, shopId: number, feed: boolean, shop: boolean) => {
    await getDb().update(feeds).set({ isApproved: feed }).where(eq(feeds.id, feedId));
    await getDb().update(shops).set({ isApproved: shop }).where(eq(shops.id, shopId));
  };

  it('is absent from the category page, product page, search, sitemap and /go unless both are approved', async () => {
    const { feedId, shopId, view } = await mappedImport();
    const search = async () => (await getPublicSearchPage(parseSearchTerm('Catalogo Prueba Uno'), 1))?.state;

    for (const [feed, shop] of [[true, false], [false, true], [false, false]] as const) {
      await setApproval(feedId, shopId, feed, shop);
      expect(await publicView(view), `feed ${feed} shop ${shop}`).toEqual(ABSENT_VIEW);
      expect(await search(), `search, feed ${feed} shop ${shop}`).toBe('no-results');
    }

    await setApproval(feedId, shopId, true, true);
    expect(await publicView(view)).toEqual(PUBLIC_VIEW);
    expect(await search()).toBe('results');
  });

  it('is absent again as soon as the feed or the shop is unapproved, without another import', async () => {
    const { feedId, shopId, view } = await mappedImport();
    await setApproval(feedId, shopId, true, true);
    expect(await publicView(view)).toEqual(PUBLIC_VIEW);

    await setApproval(feedId, shopId, false, true);

    expect(await publicView(view)).toEqual(ABSENT_VIEW);
  });

  it('writes no approval, hidden or review flag when it imports', async () => {
    await write('banderas.csv', catalogueCsv([ROW_A, ROW_B]));
    const { feedId, shopId } = await aFileFeed('banderas.csv', { shopApproved: false });
    const feedsBefore = await getDb().select().from(feeds);
    const shopsBefore = await getDb().select().from(shops);

    await importFromFolder(dir, { feedId });

    expect(await getDb().select().from(feeds)).toEqual(feedsBefore);
    expect(await getDb().select().from(shops)).toEqual(shopsBefore);
    expect((await getDb().select().from(shops).where(eq(shops.id, shopId)))[0].isApproved).toBe(false);
    for (const product of await allProducts()) expect(product.isHidden).toBe(false);
    for (const offer of await allOffers()) expect([offer.isHidden, offer.inReview]).toEqual([false, false]);
  });

  it('an unapproved file feed leaves no row at all, whether or not the file exists', async () => {
    await write('presente.csv', catalogueCsv([ROW_A]));
    const shop = await insertShop();
    const there = await insertFileFeed(shop.id, 'presente.csv', { isApproved: false });
    const absent = await insertFileFeed(shop.id, 'ausente.csv', { isApproved: false });

    const all = await importFromFolder(dir);
    const one = await importFromFolder(dir, { feedId: absent });

    expect(all.feeds).toEqual([]);
    expect(one.feeds[0]).toMatchObject({ outcome: 'skipped', skipReason: 'not_approved' });
    expect(importExitCode(one)).toBe(0);
    expect(there).toBeGreaterThan(0);
    expect(await allProducts()).toEqual([]);
    expect(await allOffers()).toEqual([]);
  });

  it('renaming an approved file feed unapproves it and takes its offers off the public readers (AC 12)', async () => {
    const { feedId, shopId, view } = await mappedImport();
    await setApproval(feedId, shopId, true, true);
    expect(await publicView(view)).toEqual(PUBLIC_VIEW);

    const result = await updateFeed(categoryForm({ id: feedId, fileName: 'renombrado.csv' }));

    expect(result).toEqual({ status: 'written', id: feedId, unapproved: true });
    expect(await publicView(view)).toEqual(ABSENT_VIEW);
  });
});

describe('two shops, one product, through a shared EAN (AC 30)', () => {
  async function twoShops(second: Partial<typeof ROW_A>) {
    await write('tienda-a.csv', catalogueCsv([{ ...ROW_A, price: '10,50', url: 'https://tienda-a.example/p/1' }]));
    await write('tienda-b.csv', catalogueCsv([{ ...ROW_A, id: 'b-9', price: '9,20', url: 'https://tienda-b.example/articulo?id=9', ...second }]));
    const a = await aFileFeed('tienda-a.csv', { shopName: 'Tienda Alfa' });
    const b = await aFileFeed('tienda-b.csv', { shopName: 'Tienda Beta' });
    const [target] = await fiveTargets();
    await insertCategoryMapping(a.feedId, ROW_A.category, target.id);
    await insertCategoryMapping(b.feedId, ROW_A.category, target.id);
    await importFromFolder(dir);
    return { a, b, target };
  }

  it('makes one product page with both offers, cheapest first, each with its own link', async () => {
    await twoShops({});

    expect(await allProducts()).toHaveLength(1);
    expect(await allOffers()).toHaveLength(2);
    const page = await getPublicProductBySlug((await productSlugs())[0]);
    expect(page?.offers.map((offer) => [offer.shopName, offer.priceCents])).toEqual([
      ['Tienda Beta', 920],
      ['Tienda Alfa', 1050],
    ]);
    const locations = [];
    for (const offer of page!.offers) locations.push((await callGo(offer.offerId)).headers.get('location'));
    expect(locations).toEqual(['https://tienda-b.example/articulo?id=9', 'https://tienda-a.example/p/1']);
    expect((await allClicks()).map((click) => click.offerId).sort()).toEqual(page!.offers.map((offer) => offer.offerId).sort());
  });

  it('does not converge two files that share only a brand and part number (S7.1 is not built)', async () => {
    await write('sin-a.csv', catalogueCsv([{ ...ROW_A, ean: '', part_number: 'PN-777', url: 'https://tienda-a.example/p/1' }]));
    await write('sin-b.csv', catalogueCsv([{ ...ROW_A, id: 'b-9', ean: '', part_number: 'PN-777', url: 'https://tienda-b.example/p/9' }]));
    await aFileFeed('sin-a.csv');
    await aFileFeed('sin-b.csv');

    await importFromFolder(dir);

    expect(await allProducts()).toHaveLength(2);
  });
});

describe('demo feeds and file feeds do not read each other\'s folders (AC 35)', () => {
  it('a demo feed reads demo/feeds even when the catalogue folder holds a file of the same name', async () => {
    await write('tienda-demo-uno.csv', catalogueCsv([{ ...ROW_A, title: 'Titulo Del Catalogo Que No Debe Entrar' }]));
    const shop = await insertShop();
    await insertFeed(shop.id, { url: 'demo-feed:tienda-demo-uno.csv', isDemo: true });

    const report = await importFromFolder(dir);

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported' });
    const titles = (await allProducts()).map((product) => product.title);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles).not.toContain('Titulo Del Catalogo Que No Debe Entrar');
    expect((await allOffers()).some((offer) => offer.url === ROW_A.url)).toBe(false);
  });

  it('a demo feed still imports with no catalogue folder at all', async () => {
    const shop = await insertShop();
    await insertFeed(shop.id, { url: 'demo-feed:tienda-demo-uno.csv', isDemo: true });

    const report = await importFeeds(getDb(), {
      deps: { readSource: (feed) => readFeedSource(feed, { catalogueDir: path.join(dir, 'never-made') }) },
    });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported' });
    expect(importExitCode(report)).toBe(0);
  });

  it('a feed of any other kind with a bare file name is refused and never reads the catalogue file', async () => {
    await write('presente.csv', catalogueCsv([ROW_A]));
    const shop = await insertShop();
    await insertFeed(shop.id, { url: 'presente.csv' });

    const report = await importFromFolder(dir);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'unsupported_url' });
    expect(await allOffers()).toEqual([]);
  });
});
