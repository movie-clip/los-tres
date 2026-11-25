import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';
import { createTranslator } from 'use-intl/core';

import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import messages from '../../messages/es-ES.json';
import { signInAsAdmin } from '../support/admin-e2e';
import { psql, psqlScalar, verb } from '../support/e2e-stack';
import { normaliseSpaces } from '../support/messages';
import { expectNoSetCookie, stripScripts } from '../support/page-checks';

// S3.7 (T3.7.4), the one flow from sign-in to a public product made from a catalogue file: the
// admin registers a shop and a file feed through the forms, approves both, the import in the e2e `app` reads
// the fixed invented file through the bind mount, the admin maps the file's category, and the product
// is on its public page with a link that goes to the shop through /go.
//
// Ordering: this spec runs in the `serial` project (#363), one worker, after the `chromium` project,
// so nothing reads the database beside it. Its feed is approved for a while, and an approved feed
// would be read by any later `import-feeds`, so it unapproves its feed and shop in the spec and
// `cleanRows()` does it again, before and after the run.
//
// What it leaves behind: the FIXED shop and feed rows (unapproved), nothing else. The file is
// written into the repo's catalogue-files/ under one fixed invented name and removed again, before
// and after the run; no other file of that folder is read or touched. Its offers, product, click rows
// and category records are deleted by `cleanRows()` before and after, so a repeated run adds no row.
// It signs in as the e2e admin the global setup created.
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const copy = messages.Admin.Sources;
const form = messages.Admin.Form;
const errors = form.Errors;
const categoriesT = createTranslator({ locale: 'es-ES', messages, namespace: 'Admin.Categories' });

const SHOP = { slug: 'e2e-cf-tienda', name: 'Tienda e2e catalogo' };
const FILE = 'e2e-catalogo-fixed.csv';
const PRODUCT = { title: 'Filtro e2e catalogo fijo', slug: 'filtro-e2e-catalogo-fijo', brand: 'Marca e2e' };
// The second product of the removal test (S3.3): the one row a file lists when it drops the fixed row.
const REPLACEMENT = { id: 'e2e-cf-2', title: 'Filtro e2e catalogo reemplazo', slug: 'filtro-e2e-catalogo-reemplazo' };
const FEED_CATEGORY = 'Filtros e2e catalogo';
const SHOP_LINK = 'https://e2e-catalogo.example/producto/fijo?ref=e2e&x=1';
const PRICE_TEXT = '12,99';
const PRICE_SHOWN = '12,99 €';
const TARGET = FIXED_CATEGORY_TREE.children[1];

const FOLDER = path.join(process.cwd(), 'catalogue-files');
const FILE_PATH = path.join(FOLDER, FILE);

const count = (statement: string): number => Number(psqlScalar(statement));
const sql = {
  feedId: (): number =>
    count(`select coalesce(max(f.id), 0) from feeds f join shops s on s.id = f.shop_id where s.slug = '${SHOP.slug}'`),
  shopExists: (): boolean => count(`select count(*) from shops where slug = '${SHOP.slug}'`) > 0,
  feedRows: (): number =>
    count(`select count(*) from feeds f join shops s on s.id = f.shop_id where s.slug = '${SHOP.slug}'`),
  clicks: (feedId: number): number =>
    count(`select count(*) from clicks where offer_id in (select id from offers where feed_id = ${feedId})`),
  offerId: (feedId: number): number => count(`select coalesce(max(id), 0) from offers where feed_id = ${feedId}`),
};

/** The fixed invented file: one row, a decimal-comma price (so quoted), and a category cell. */
function writeCatalogueFile(): void {
  mkdirSync(FOLDER, { recursive: true });
  const rows = [
    'id,title,price,url,brand,category,currency',
    `e2e-cf-1,${PRODUCT.title},"${PRICE_TEXT}",${SHOP_LINK},${PRODUCT.brand},${FEED_CATEGORY},EUR`,
  ];
  writeFileSync(FILE_PATH, `${rows.join('\n')}\n`, 'utf8');
}

/** A file that lists only the replacement row, so the fixed row is missing from it (S3.3). */
function writeReplacementFile(): void {
  mkdirSync(FOLDER, { recursive: true });
  const rows = [
    'id,title,price,url,brand,category,currency',
    `${REPLACEMENT.id},${REPLACEMENT.title},"5,00",https://e2e-catalogo.example/producto/reemplazo,${PRODUCT.brand},${FEED_CATEGORY},EUR`,
  ];
  writeFileSync(FILE_PATH, `${rows.join('\n')}\n`, 'utf8');
}

function removeCatalogueFile(): void {
  rmSync(FILE_PATH, { force: true });
}

/**
 * Puts the fixed rows back to what the creation leaves, and removes everything an import and a
 * click left. Runs before and after the whole spec, so an aborted run is cleaned by the next one.
 * The shop and feed rows stay, unapproved, on their fixed file name.
 */
function cleanRows(): void {
  removeCatalogueFile();
  psql(`update shops set is_approved = false, name = '${SHOP.name}' where slug = '${SHOP.slug}'`);
  psql(
    `update feeds set is_approved = false, url = '${FILE}' where source_type = 'catalogue_file' and shop_id in (select id from shops where slug = '${SHOP.slug}')`,
  );
  const mine = `select f.id from feeds f join shops s on s.id = f.shop_id where s.slug = '${SHOP.slug}'`;
  psql(`delete from clicks where offer_id in (select id from offers where feed_id in (${mine}))`);
  psql(`delete from fitments where feed_id in (${mine})`);
  psql(`delete from feed_category_mappings where feed_id in (${mine})`);
  psql(`delete from offers where feed_id in (${mine})`);
  psql(
    `delete from products where slug in ('${PRODUCT.slug}', '${REPLACEMENT.slug}') and not exists (select 1 from offers o where o.product_id = products.id)`,
  );
}

/** The import in the e2e `app`, on the one feed: the same verb the e2e setup runs, with `--feed`. */
function composeImport(feedId: number): { status: number | null; out: string } {
  const result = verb('app', ['import-feeds', '--feed', String(feedId)], { timeout: 150_000 });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test.beforeAll(() => {
  cleanRows();
});
test.afterAll(() => {
  cleanRows();
});

const SOURCES = '/admin/tiendas';

function shopGroup(page: Page): Locator {
  return page
    .getByTestId('sources-list')
    .locator('li')
    .filter({ has: page.getByRole('heading', { level: 2, name: SHOP.name, exact: true }) });
}
const feedRow = (page: Page, feedId: number): Locator => shopGroup(page).getByTestId(`source-feed-${feedId}`);
const shopRow = (page: Page): Locator => shopGroup(page).getByTestId(/^source-shop-/);

/** A signed-in admin page on the list. */
async function openList(page: Page): Promise<void> {
  await signInAsAdmin(page);
  await page.goto(SOURCES);
}

test.describe('a shop and a file feed, registered through the forms (AC 1, 2, 9, 10)', () => {
  test('creates the fixed shop when it is missing, unapproved and with no feed of its own yet', async ({ page }) => {
    await openList(page);
    if (!sql.shopExists()) {
      await page.getByTestId('add-shop').click();
      await page.getByLabel(form.nameLabel, { exact: true }).fill(SHOP.name);
      await page.getByLabel(form.slugLabel, { exact: true }).fill(SHOP.slug);
      await page.getByTestId('form-submit').click();
      await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=tienda-creada$/);
      await expect(page.getByTestId('admin-notice')).toHaveText(copy.noticeShopCreated);
    }
    await expect(shopGroup(page)).toHaveCount(1);
    await expect(shopRow(page).getByTestId('source-tag')).toHaveText(copy.shopNotApproved);
  });

  test('creates the fixed file feed with no file in the folder, then refuses the same name again (AC 4, 9)', async ({ page }) => {
    expect(existsSync(FILE_PATH), 'no file yet: registering does not read the folder').toBe(false);
    await openList(page);
    const fresh = sql.feedRows() === 0;
    await shopGroup(page).getByRole('link', { name: /^Añadir feed/ }).click();
    await page.waitForLoadState('networkidle');
    await page.locator('#source-origin').selectOption('catalogue_file');
    await page.locator('#source-file').fill(FILE);
    if (fresh) {
      await page.getByTestId('form-submit').click();
      await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=feed-creado$/);
      await expect(page.getByTestId('admin-notice')).toHaveText(copy.noticeFeedCreated);
    } else {
      // The fixed feed exists from an earlier run: the same form shows the duplicate refusal instead.
      await page.getByTestId('form-submit').click();
      await expect(page.locator('#source-file-error')).toHaveText(errors.fileDuplicate);
      await page.goto(SOURCES);
    }

    const feedId = sql.feedId();
    expect(feedId).toBeGreaterThan(0);
    const row = feedRow(page, feedId);
    await expect(row.getByTestId('source-tag')).toHaveText(copy.feedNotApproved);
    await expect(row.getByTestId('source-value')).toHaveText(`${copy.fileLabel} ${FILE}`);
    await expect(row).toContainText(copy.feedMetaFile);
    await expect(row).not.toContainText(copy.domainLabel);
    await expect(row).not.toContainText(copy.feedMetaUpload);
    await expect(row).not.toContainText(/Red:/);
    await expect(row.getByTestId('demo-mark')).toHaveCount(0);
    await expect(shopRow(page).getByTestId('source-tag')).toHaveText(copy.shopNotApproved);

    // The same name again, from the form: one feed only, and the message does not repeat the name.
    await shopGroup(page).getByRole('link', { name: /^Añadir feed/ }).click();
    await page.waitForLoadState('networkidle');
    await page.locator('#source-origin').selectOption('catalogue_file');
    await page.locator('#source-file').fill(FILE);
    await page.getByTestId('form-submit').click();
    const message = page.locator('#source-file-error');
    await expect(message).toHaveText(errors.fileDuplicate);
    expect(await message.innerText()).not.toContain(FILE);
    expect(sql.feedRows()).toBe(1);

    // Still nothing was read and nothing is public.
    expect(existsSync(FILE_PATH)).toBe(false);
  });
});

test.describe('the two approvals, and a changed file name (AC 11, 12, 14)', () => {
  test('approving the shop does not approve the feed, and the other way round; each is its own control', async ({ page }) => {
    const feedId = sql.feedId();
    await openList(page);

    await shopRow(page).getByTestId('source-approve').click();
    await expect(shopRow(page).getByTestId('source-done')).toHaveText(copy.doneShopApproved);
    await expect(feedRow(page, feedId).getByTestId('source-tag')).toHaveText(copy.feedNotApproved);

    await feedRow(page, feedId).getByTestId('source-approve').click();
    const done = feedRow(page, feedId).getByTestId('source-done');
    await expect(done).toHaveText(copy.doneFeedApproved);
    expect(await done.innerText()).not.toMatch(/producto|aparec/i);
    await expect(feedRow(page, feedId).getByTestId('source-tag')).toHaveText(copy.feedApproved);
  });
});

test.describe('from the file to a public product (AC 18, 19, 26 to 29, 42)', () => {
  let feedId = 0;
  let offerId = 0;
  const productPath = `/producto/${PRODUCT.slug}`;

  test('before the import and the mapping the product is public nowhere', async ({ request }) => {
    feedId = sql.feedId();
    writeCatalogueFile();
    const product = await request.get(productPath);
    expect(product.status()).toBe(404);
    expectNoSetCookie(product);
  });

  test('the Compose import reads the file through the mount, prints the usual line and no path', () => {
    const result = composeImport(feedId);

    expect(result.status, result.out).toBe(0);
    expect(result.out).toContain(
      `feed ${feedId} "${SHOP.name}": imported rows=1 products_created=1 offers_created=1 offers_updated=0 offers_removed=0 rejected=0`,
    );
    for (const leak of [FILE, 'catalogue-files', '/app/', SHOP_LINK, 'e2e-catalogo.example']) expect(result.out).not.toContain(leak);
    offerId = sql.offerId(feedId);
    expect(offerId).toBeGreaterThan(0);

    // Running it again on the unchanged file creates nothing (AC 25).
    const again = composeImport(feedId);
    expect(again.status, again.out).toBe(0);
    expect(again.out).toContain('products_created=0 offers_created=0');
  });

  test('the file category is listed as not reviewed and the product is still not public; mapping it publishes the product on the next request, with no second import (AC 28, 29)', async ({ page, request }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');
    const section = page.getByTestId(`category-feed-${feedId}`);
    await expect(section.getByTestId('category-name')).toHaveText([FEED_CATEGORY]);
    await expect(section.getByTestId('category-count')).toHaveText(categoriesT('rowCount', { count: 1, countText: '1' }));
    await expect(section.getByTestId('category-tag')).toHaveText(messages.Admin.Categories.tagPending);

    expect((await request.get(productPath)).status()).toBe(404);
    expect((await request.get(`/go/${offerId}`, { maxRedirects: 0 })).status()).toBe(404);
    expect(sql.clicks(feedId)).toBe(0);

    const row = section.getByTestId('category-row');
    await row.getByRole('combobox').selectOption({ label: TARGET.name });
    await row.getByTestId('category-assign').click();
    await expect(row.getByTestId('category-tag')).toHaveText(categoriesT('tagMapped', { target: TARGET.name }));

    const response = await request.get(productPath);
    expect(response.status()).toBe(200);
    expectNoSetCookie(response);
    const sitemap = await (await request.get('/sitemaps/productos-1.xml')).text();
    expect(sitemap).toContain(`/producto/${PRODUCT.slug}`);
    const category = await request.get(`/categoria/${TARGET.slug}`);
    expect(stripScripts(await category.text())).toContain(PRODUCT.title);
  });

  test('the public page shows the price with IVA in euros, the shop, and a link that goes to the shop through /go and is counted once', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const foreign: string[] = [];
    page.on('request', (req) => {
      const host = new URL(req.url()).hostname;
      if (!['127.0.0.1', 'localhost'].includes(host)) foreign.push(host);
    });
    await page.goto(productPath);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PRODUCT.title);
    const rows = page.getByTestId('offer-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.getByTestId('offer-shop')).toHaveText(SHOP.name);
    expect(normaliseSpaces((await rows.getByTestId('offer-price').textContent()) ?? '')).toBe(PRICE_SHOWN);
    const href = await rows.getByTestId('offer-go').getAttribute('href');
    expect(href).toBe(`/go/${offerId}`);
    expect(await page.content()).not.toContain('e2e-catalogo.example');
    expect(await context.cookies()).toEqual([]);

    // Playwright does not route a navigation's redirect target, so the browser's own request to the
    // reserved .example host (it never resolves, nothing leaves the machine) is what proves the
    // redirect went to exactly the address of the file's `url` column.
    const shopRequest = page.waitForRequest((req) => new URL(req.url()).hostname === 'e2e-catalogo.example');
    await rows.getByTestId('offer-go').click();
    expect((await shopRequest).url()).toBe(SHOP_LINK);
    expect(sql.clicks(feedId)).toBe(1);
    expect(await context.cookies()).toEqual([]);
    expect(foreign).toEqual(['e2e-catalogo.example']);
    await context.close();
  });

  // S3.3: removal on the real stack. Run after the click test (the click count stays 1: a removed
  // offer answers /go with 404 and records nothing) and before the unapproval, which needs the fixed
  // file back in the folder. cleanRows() deletes the replacement product and every offer afterwards.
  test('a file that drops the row removes its offer on the next import, and listing it again brings the same offer back (S3.3)', async ({ request }) => {
    writeReplacementFile();
    const dropped = composeImport(feedId);

    expect(dropped.status, dropped.out).toBe(0);
    expect(dropped.out).toContain(
      `feed ${feedId} "${SHOP.name}": imported rows=1 products_created=1 offers_created=1 offers_updated=0 offers_removed=1 rejected=0`,
    );
    expect(dropped.out).not.toContain('removal:');
    expect((await request.get(productPath)).status()).toBe(404);
    expect((await request.get(`/go/${offerId}`, { maxRedirects: 0 })).status()).toBe(404);
    expect(await (await request.get('/sitemaps/productos-1.xml')).text()).not.toContain(`/producto/${PRODUCT.slug}`);
    expect((await request.get(`/producto/${REPLACEMENT.slug}`)).status()).toBe(200);
    expect(sql.clicks(feedId)).toBe(1);

    writeCatalogueFile();
    const back = composeImport(feedId);

    expect(back.status, back.out).toBe(0);
    expect(back.out).toContain('products_created=0 offers_created=0 offers_updated=1 offers_removed=1 rejected=0');
    const page = await request.get(productPath);
    expect(page.status()).toBe(200);
    expect(stripScripts(await page.text())).toContain(`/go/${offerId}`);
    expect(await (await request.get('/sitemaps/productos-1.xml')).text()).toContain(`/producto/${PRODUCT.slug}`);
    expect((await request.get(`/producto/${REPLACEMENT.slug}`)).status()).toBe(404);
    expect(count(`select count(*) from offers where id = ${offerId} and not is_removed`)).toBe(1);
  });

  test('unapproving the feed takes the product off every public reader at once, and the import then skips it without a file (AC 15)', async ({ page, request }) => {
    await signInAsAdmin(page);
    await page.goto(SOURCES);
    await page.waitForLoadState('networkidle');
    await feedRow(page, feedId).getByTestId('source-disable').click();
    await feedRow(page, feedId).getByTestId('source-confirm-yes').click();
    await expect(feedRow(page, feedId).getByTestId('source-done')).toHaveText(copy.doneFeedDisabled);

    expect((await request.get(productPath)).status()).toBe(404);
    expect((await request.get(`/go/${offerId}`, { maxRedirects: 0 })).status()).toBe(404);
    expect(await (await request.get('/sitemaps/productos-1.xml')).text()).not.toContain(`/producto/${PRODUCT.slug}`);
    expect(sql.clicks(feedId)).toBe(1);

    removeCatalogueFile();
    const skipped = composeImport(feedId);
    expect(skipped.status, skipped.out).toBe(0);
    expect(skipped.out).toContain(`feed ${feedId} "${SHOP.name}": skipped not_approved`);

    // The shop goes back to unapproved too: the fixed rows end the run unapproved.
    await shopRow(page).getByTestId('source-disable').click();
    await shopRow(page).getByTestId('source-confirm-yes').click();
    await expect(shopRow(page).getByTestId('source-done')).toHaveText(copy.doneShopDisabled);
    expect(count(`select count(*) from shops where slug = '${SHOP.slug}' and not is_approved`)).toBe(1);
  });
});
