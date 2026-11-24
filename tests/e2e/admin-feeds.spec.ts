import { expect, test, type Locator, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { adminTest, signInAsAdmin } from '../support/admin-e2e';
import { psql, psqlScalar } from '../support/e2e-stack';
import { loadEnv } from '../support/env';
import { expectNoSetCookie, reflowProblems, stripScripts } from '../support/page-checks';

// US-3.1 against the e2e stack: the admin registers a network, a shop and a feed through
// the forms, from sign-in to the feed (ACs 37 to 43), and the pages and forms keep their
// promises in a browser.
//
// This spec writes to the e2e database, which admin-sources.spec.ts (S2.3, read-only)
// never does, so it is bounded and runs in the `serial` project: it uses two FIXED, test-only sets of rows (a network, a shop and a
// feed each, identified by a stable slug and a stable host), created through the forms the first
// time and found again on every later run, so repeated runs never add a row (S3.1 follow-up,
// #295). `resetRows()` puts a found set back in the state the creation leaves (names, the feed's
// address and network, nothing approved). The one feed it approves is un-approved again by the
// spec itself (that is what AC 20 shows) and, as a safety net, by `releaseRows()` before and
// after the run, so an approved e2e feed with an https address never reaches the next
// `import-feeds`. There is no delete verb. It signs in as the e2e admin the global setup created.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

/** A fixed token, not a run id: the rows of this spec are reused from run to run. */
const RUN = 'fixed';

const copy = messages.Admin.Sources;
const form = messages.Admin.Form;
const errors = form.Errors;

const NETWORK = { name: `Red e2e ${RUN}`, slug: `e2e-red-${RUN}` };
const SHOP = { name: `Tienda e2e ${RUN}`, slug: `e2e-tienda-${RUN}` };
const HOST = `e2e-feeds-${RUN}.example`;
const HOST_AFTER = `e2e-feeds-${RUN}-b.example`;
const KEY = `KEY-E2E-${RUN}`;
const TOKEN = `TOKEN-E2E-${RUN}`;
const URL_FIRST = `https://${HOST}:8443/private/${KEY}/catalogo.csv?apikey=${KEY}&token=${TOKEN}#frag-${KEY}`;
const URL_SECOND = `https://${HOST_AFTER}/nuevo.csv?apikey=${KEY}`;
/** What of the first and second address must never be on a page: everything but the host. */
const LEAKS = [KEY, TOKEN, 'apikey', 'token=', ':8443', '/private/', 'catalogo.csv', 'nuevo.csv', 'frag-', `https://${HOST}`, `https://${HOST_AFTER}`];

/** The longest values validation accepts: a 120-character name, a 64-character slug, a 253-character host. */
const LONG_NAME = 'W'.repeat(120);
const LONG_NETWORK_SLUG = `e2e-long-red-${RUN}-`.padEnd(64, 'x');
const LONG_SHOP_SLUG = `e2e-long-tienda-${RUN}-`.padEnd(64, 'x');
const LONG_HOST = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
const LONG_URL = `https://${LONG_HOST}/feed.csv`;

/** Un-approves everything this spec may have approved. */
function releaseRows(): void {
  psql("update feeds set is_approved = false where url like 'https://e2e-feeds-%'");
  psql("update shops set is_approved = false where slug like 'e2e-tienda-%' or slug like 'e2e-long-tienda-%'");
}

/** The two fixed sets of rows: what a later run finds, and the state each is reset to. */
const FIXED_SETS = [
  { network: NETWORK, shop: SHOP, url: URL_FIRST },
  { network: { name: LONG_NAME, slug: LONG_NETWORK_SLUG }, shop: { name: LONG_NAME, slug: LONG_SHOP_SLUG }, url: LONG_URL },
];

const count = (statement: string): number => Number(psqlScalar(statement));
const networkExists = (slug: string): boolean => count(`select count(*) from networks where slug = '${slug}'`) > 0;
const shopExists = (slug: string): boolean => count(`select count(*) from shops where slug = '${slug}'`) > 0;
const feedExists = (shopSlug: string): boolean =>
  count(`select count(*) from feeds f join shops s on s.id = f.shop_id where s.slug = '${shopSlug}'`) > 0;

/**
 * Puts every fixed row that already exists back in the state its creation leaves: names, nothing
 * approved, and the feed on its first address and network. A row that does not exist is not
 * touched: the forms create it.
 */
function resetRows(): void {
  for (const { network, shop, url } of FIXED_SETS) {
    psql(`update networks set name = '${network.name}' where slug = '${network.slug}'`);
    psql(`update shops set name = '${shop.name}', is_approved = false where slug = '${shop.slug}'`);
    psql(
      `update feeds set url = '${url}', is_approved = false, network_id = (select id from networks where slug = '${network.slug}') where shop_id = (select id from shops where slug = '${shop.slug}')`,
    );
  }
}

test.beforeAll(() => {
  releaseRows();
  resetRows();
});
test.afterAll(() => {
  releaseRows();
});

const SOURCES = '/admin/tiendas';
const SHOP_NAMES = ['Tienda Demo Uno', 'Tienda Demo Dos'];

/** The shop group (its row and its feeds) whose heading is `name`. */
function shopGroup(page: Page, name: string): Locator {
  return page
    .getByTestId('sources-list')
    .locator('li')
    .filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) });
}

/** The shop group that shows `slug` in its value line. */
function shopGroupBySlug(page: Page, slug: string): Locator {
  return page.getByTestId('sources-list').locator('li').filter({ hasText: slug }).first();
}

async function expectNoLeak(page: Page, label: string): Promise<void> {
  const response = await page.goto(SOURCES);
  const html = (await response?.text()) ?? '';
  expect(html, label).toBeTruthy();
  for (const leak of LEAKS) expect(html, `${label}: ${leak}`).not.toContain(leak);
  const dom = await page.content();
  for (const leak of LEAKS) expect(dom, `${label} DOM: ${leak}`).not.toContain(leak);
}

async function createNetwork(page: Page, name: string, slug: string): Promise<void> {
  await page.goto(SOURCES);
  await page.getByTestId('add-network').click();
  await expect(page).toHaveURL(/\/admin\/tiendas\/red\/nueva\/?$/);
  await page.getByLabel(form.nameLabel, { exact: true }).fill(name);
  await page.getByLabel(form.slugLabel, { exact: true }).fill(slug);
  await page.getByTestId('form-submit').click();
  await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=red-creada$/);
}

async function createShop(page: Page, name: string, slug: string): Promise<void> {
  await page.goto(SOURCES);
  await page.getByTestId('add-shop').click();
  await expect(page).toHaveURL(/\/admin\/tiendas\/tienda\/nueva\/?$/);
  await page.getByLabel(form.nameLabel, { exact: true }).fill(name);
  await page.getByLabel(form.slugLabel, { exact: true }).fill(slug);
  await page.getByTestId('form-submit').click();
  await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=tienda-creada$/);
}

async function createFeed(page: Page, shopSlug: string, networkName: string, url: string): Promise<void> {
  await page.goto(SOURCES);
  await shopGroupBySlug(page, shopSlug).getByRole('link', { name: /^Añadir feed/ }).click();
  await expect(page).toHaveURL(/\/admin\/tiendas\/feed\/nuevo\?tienda=\d+$/);
  await page.getByLabel(form.Feed.networkLabel, { exact: true }).selectOption({ label: networkName });
  await page.getByLabel(form.Feed.urlLabelNew, { exact: true }).fill(url);
  await page.getByTestId('form-submit').click();
  await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=feed-creado$/);
}

test.describe('anonymous visitors (AC 3)', () => {
  test('every form route sends an anonymous request to sign-in, with no cookie and none of the form', async ({ request }) => {
    for (const path of [
      '/admin/tiendas/red/nueva',
      '/admin/tiendas/tienda/nueva',
      '/admin/tiendas/feed/nuevo',
      '/admin/tiendas/red/1/editar',
      '/admin/tiendas/tienda/1/editar',
      '/admin/tiendas/feed/1/editar',
    ]) {
      const raw = await request.get(path, { maxRedirects: 0 });
      expect(raw.status(), path).toBeGreaterThanOrEqual(300);
      expect(raw.status(), path).toBeLessThan(400);
      expect(raw.headers().location, path).toContain('/admin/acceso');
      expectNoSetCookie(raw);
      const body = stripScripts(await raw.text());
      for (const shown of [form.nameLabel, form.Feed.urlLabelNew, 'source-form', 'name="url"']) {
        expect(body, `${path}: ${shown}`).not.toContain(shown);
      }
    }
  });
});

test.describe('the form routes, signed in (AC 3, 37)', () => {
  test('each is noindex and no-store, sets no cookie, keeps the nav item current and adds no nav link', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(SOURCES);
    const hrefs = async (name: RegExp) => (await page.getByRole('link', { name }).first().getAttribute('href'))!;
    const routes: [string, string][] = [
      ['/admin/tiendas/red/nueva', messages.Admin.Meta.newNetworkTitle],
      ['/admin/tiendas/tienda/nueva', messages.Admin.Meta.newShopTitle],
      ['/admin/tiendas/feed/nuevo', messages.Admin.Meta.newFeedTitle],
      [await hrefs(/^Editar red /), messages.Admin.Meta.editNetworkTitle],
      [await hrefs(/^Editar tienda /), messages.Admin.Meta.editShopTitle],
      [await hrefs(/^Editar feed /), messages.Admin.Meta.editFeedTitle],
    ];
    for (const [path, title] of routes) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      expect(response?.headers()['x-robots-tag'], path).toMatch(/noindex/);
      expect(response?.headers()['cache-control'], path).toMatch(/no-store/);
      expect(response?.headers()['set-cookie'], path).toBeUndefined();
      await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute('content', /noindex/);
      await expect(page, path).toHaveTitle(new RegExp(title.split(' | ')[0]));
      const nav = page.getByTestId('admin-nav');
      await expect(nav.getByRole('link', { name: messages.Admin.Nav.feeds }), path).toHaveAttribute('aria-current', 'page');
      // S4.2 (AC 9) and S2.4 (AC 7): the category and product screens are the other live links; no form route adds one.
      expect(await nav.locator('a').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href'))), path).toEqual([
        '/admin',
        '/admin/tiendas',
        '/admin/categorias',
        '/admin/productos',
      ]);
      await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1);
    }
  });

  test('a malformed or unknown id is the admin not-found screen, inside the shell', async ({ page }) => {
    await signInAsAdmin(page);
    for (const path of [
      '/admin/tiendas/red/2000000000/editar',
      '/admin/tiendas/tienda/abc/editar',
      '/admin/tiendas/feed/0/editar',
      '/admin/tiendas/feed/2000000000/editar',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: messages.Admin.NotFound.heading }), path).toBeVisible();
      await expect(page.getByTestId('admin-nav'), path).toBeVisible();
      await expect(page.getByTestId('source-form'), path).toHaveCount(0);
    }
  });

  test('every admin not-found carries the not-found tab title, an existing id keeps its edit title (6B)', async ({ page }) => {
    loadEnv();
    const siteName = (process.env.SITE_NAME ?? '').trim();
    const notFoundTitle = messages.Admin.Meta.notFoundTitle.replace('{siteName}', siteName);
    await signInAsAdmin(page);
    const titles: Record<string, string> = {};
    for (const path of [
      '/admin/tiendas/feed/999999/editar',
      '/admin/tiendas/red/999999/editar',
      '/admin/tiendas/tienda/999999/editar',
      '/admin/tiendas/feed/abc/editar',
      '/admin/x',
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1, name: messages.Admin.NotFound.heading }), path).toBeVisible();
      titles[path] = await page.title();
    }
    // One comparison, so a failure lists every route whose tab title is not the not-found one.
    expect(titles).toEqual(Object.fromEntries(Object.keys(titles).map((path) => [path, notFoundTitle])));

    await page.goto(SOURCES);
    const existing = (await page.getByRole('link', { name: /^Editar feed / }).first().getAttribute('href'))!;
    const response = await page.goto(existing);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(messages.Admin.Meta.editFeedTitle.replace('{siteName}', siteName));
    await expect(page).not.toHaveTitle(notFoundTitle);
  });

  test('signed out, an edit URL still redirects to sign-in and is not a 404 (6B)', async ({ request }) => {
    const raw = await request.get('/admin/tiendas/feed/999999/editar', { maxRedirects: 0 });
    expect(raw.status()).toBeGreaterThanOrEqual(300);
    expect(raw.status()).toBeLessThan(400);
    expect(raw.headers().location).toContain('/admin/acceso');
  });

  test('the list offers no delete control and no field mapping choice anywhere (AC 18, 34)', async ({ page }) => {
    await signInAsAdmin(page);
    for (const path of [SOURCES, '/admin/tiendas/feed/nuevo', '/admin/tiendas/red/nueva', '/admin/tiendas/tienda/nueva']) {
      await page.goto(path);
      const text = (await page.locator('main').innerText()).toLowerCase();
      expect(text, path).not.toMatch(/eliminar|borrar|suprimir|mapeo|mapping/);
      await expect(page.getByRole('button', { name: /eliminar|borrar|delete|remove/i }), path).toHaveCount(0);
    }
  });
});

test.describe('refusals come back next to the field, never with the address (AC 8, 12, 15, 16, 27, 41, 46)', () => {
  test('the network form refuses an empty form, a bad slug and the reserved slug demo, and writes nothing', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/tiendas/red/nueva');

    await page.getByTestId('form-submit').click();
    const name = page.getByLabel(form.nameLabel, { exact: true });
    const slug = page.getByLabel(form.slugLabel, { exact: true });
    await expect(page.locator('#source-name-error')).toHaveText(errors.nameRequired);
    await expect(page.locator('#source-slug-error')).toHaveText(errors.slugRequired);
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAttribute('aria-describedby', /source-name-error/);
    await expect(slug).toHaveAttribute('aria-describedby', /source-slug-error/);
    await expect(page).toHaveURL(/\/admin\/tiendas\/red\/nueva\/?$/);
    // Focus goes to the first failing field.
    await expect(name).toBeFocused();

    await name.fill('Una red de prueba');
    await slug.fill('Slug Mal');
    await page.getByTestId('form-submit').click();
    await expect(page.locator('#source-slug-error')).toHaveText(errors.slugInvalid);
    await expect(name).toHaveValue('Una red de prueba');
    await expect(slug).toHaveValue('Slug Mal');
    await expect(page.locator('#source-name-error')).toHaveCount(0);

    await slug.fill('demo');
    await page.getByTestId('form-submit').click();
    await expect(page.locator('#source-slug-error')).toHaveText(errors.slugReserved);
    await expect(page).toHaveURL(/\/admin\/tiendas\/red\/nueva\/?$/);
  });

  test('the shop form refuses the reserved prefix tienda-demo-, accepts nothing half-written, and a name that is too long', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/tiendas/tienda/nueva');
    await page.getByLabel(form.nameLabel, { exact: true }).fill('x'.repeat(121));
    await page.getByLabel(form.slugLabel, { exact: true }).fill('tienda-demo-x');
    await page.getByTestId('form-submit').click();
    await expect(page.locator('#source-slug-error')).toHaveText(errors.slugReserved);
    await expect(page.locator('#source-name-error')).toContainText(errors.nameTooLong.split('{max}')[0]);
    await expect(page).toHaveURL(/\/admin\/tiendas\/tienda\/nueva\/?$/);
    await page.goto(SOURCES);
    await expect(page.getByTestId('sources-list')).not.toContainText('tienda-demo-x');
  });

  test('a failed write keeps the typed name and shows the error block above the fields', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(SOURCES);
    await page.getByRole('link', { name: /^Editar red /, includeHidden: false }).first().click();
    await expect(page.getByTestId('source-form')).toBeVisible();
    // The form is server-rendered and visible before React hydrates. A value rewritten in that gap can be put
    // back by hydration, and the post then edits a real network instead of failing (seen once in the S12.2 gate:
    // the page showed "Red guardada"). Wait for the page to settle first, and check the rewrite is still there.
    await page.waitForLoadState('networkidle');
    // The id is rewritten to a row that does not exist: the real action answers failed and writes nothing.
    await page.locator('input[name="id"]').evaluate((input) => {
      (input as HTMLInputElement).value = '2000000000';
    });
    await page.getByLabel(form.nameLabel, { exact: true }).fill('Nombre tecleado');
    await expect(page.locator('input[name="id"]')).toHaveValue('2000000000');
    await page.getByTestId('form-submit').click();
    const block = page.getByTestId('admin-error');
    await expect(block).toBeVisible();
    await expect(block).toContainText(form.failedTitle);
    await expect(block).toContainText(form.failedBody);
    await expect(page.getByLabel(form.nameLabel, { exact: true })).toHaveValue('Nombre tecleado');
    await expect(page).toHaveURL(/\/editar\/?$/);
  });
});

test.describe('from sign-in to a registered feed (AC 6 to 14, 19 to 21, 23 to 27, 35, 40, 43, 44)', () => {
  let publicBefore: { sitemap: string; product: string };
  let feedId = '';

  test('creates a network, a shop and a feed through the forms; nothing is approved and the address shows as its host', async ({ page, request }) => {
    publicBefore = {
      sitemap: await (await request.get('/sitemap.xml')).text(),
      product: stripScripts(await (await request.get('/producto/demo-filtro-de-aceite-oc-1234')).text()),
    };

    // Sign in, then reach the page through the nav, as an admin would.
    await signInAsAdmin(page);
    const link = page.getByTestId('admin-nav').getByRole('link', { name: messages.Admin.Nav.feeds });
    await link.click();
    await expect(page).toHaveURL(/\/admin\/tiendas\/?$/);
    await expect(page.getByTestId('create-toolbar')).toBeVisible();
    await expect(page.getByTestId('networks-section').getByRole('heading', { level: 2, name: copy.networksHeading })).toBeVisible();

    // The network: created through the form the first time, found (and reset) on later runs.
    if (!networkExists(NETWORK.slug)) {
      await createNetwork(page, NETWORK.name, NETWORK.slug);
      await expect(page.getByTestId('admin-notice')).toHaveText(copy.noticeNetworkCreated);
    } else {
      await page.goto(SOURCES);
    }
    const network = page.getByTestId('networks-list').locator('li').filter({ hasText: NETWORK.slug });
    await expect(network).toHaveCount(1);
    await expect(network).toContainText(NETWORK.name);
    await expect(network.getByTestId('demo-mark')).toHaveCount(0);

    // The shop: unapproved, no Demo mark, and no feed until the feed is created.
    const hadFeed = shopExists(SHOP.slug) && feedExists(SHOP.slug);
    if (!shopExists(SHOP.slug)) {
      await createShop(page, SHOP.name, SHOP.slug);
      await expect(page.getByTestId('admin-notice')).toHaveText(copy.noticeShopCreated);
    } else {
      await page.goto(SOURCES);
    }
    const group = shopGroup(page, SHOP.name);
    await expect(group).toHaveCount(1);
    await expect(group.getByTestId(/^source-shop-/).getByTestId('source-tag')).toHaveText(copy.shopNotApproved);
    await expect(group.getByTestId('source-value').first()).toContainText(SHOP.slug);
    if (!hadFeed) await expect(group.getByTestId('shop-no-feeds')).toBeVisible();
    await expect(group.getByTestId('demo-mark')).toHaveCount(0);

    // The feed, from the shop's own link: the shop is preselected. A reused feed is already there.
    if (!hadFeed) {
      await group.getByRole('link', { name: /^Añadir feed/ }).click();
      await expect(page).toHaveURL(/\/admin\/tiendas\/feed\/nuevo\?tienda=\d+$/);
      await expect(page.locator('#source-shop option:checked')).toHaveText(SHOP.name);
      await expect(page.getByLabel(form.Feed.urlLabelNew, { exact: true })).toHaveValue('');
      await page.getByLabel(form.Feed.networkLabel, { exact: true }).selectOption({ label: NETWORK.name });
      await page.getByLabel(form.Feed.urlLabelNew, { exact: true }).fill(URL_FIRST);
      await page.getByTestId('form-submit').click();
      await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=feed-creado$/);
      await expect(page.getByTestId('admin-notice')).toHaveText(copy.noticeFeedCreated);
      // The notice sits under the heading and carries no value.
      const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
      const notice = await page.getByTestId('admin-notice').boundingBox();
      expect(notice!.y).toBeGreaterThan(heading!.y);
      expect(await page.getByTestId('admin-notice').innerText()).not.toContain(HOST);
    } else {
      await page.goto(SOURCES);
    }

    const feed = shopGroup(page, SHOP.name).getByTestId(/^source-feed-/);
    await expect(feed).toHaveCount(1);
    feedId = (await feed.getAttribute('data-testid'))!.replace('source-feed-', '');
    await expect(feed.getByTestId('source-tag')).toHaveText(copy.feedNotApproved);
    await expect(feed.getByTestId('source-value')).toContainText(HOST);
    await expect(feed.getByTestId('demo-mark')).toHaveCount(0);
    await expect(shopGroup(page, SHOP.name).getByTestId(/^source-shop-/).getByTestId('source-tag')).toHaveText(copy.shopNotApproved);
    await expect(shopGroup(page, SHOP.name).getByTestId('shop-no-feeds')).toHaveCount(0);

    // The host and nothing else, in the document and in what Next sent for the client.
    await expectNoLeak(page, 'after creating the feed');
  });

  test('the feed edit form opens with an empty address, the warning appears for an approved feed, and an empty save changes nothing', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(SOURCES);
    // Approve the shop and the feed (the S2.3 controls, unchanged); the result line makes no promise of offers.
    const row = shopGroup(page, SHOP.name);
    await row.getByTestId(/^source-shop-/).getByTestId('source-approve').click();
    await expect(row.getByTestId(/^source-shop-/).getByTestId('source-done')).toHaveText(copy.doneShopApproved);
    await row.getByTestId(`source-feed-${feedId}`).getByTestId('source-approve').click();
    const done = row.getByTestId(`source-feed-${feedId}`).getByTestId('source-done');
    await expect(done).toHaveText(copy.doneFeedApproved);
    expect(await done.innerText()).not.toMatch(/oferta/i);

    await page.goto(`${SOURCES}/feed/${feedId}/editar`);
    await expect(page.getByRole('heading', { level: 1, name: form.Feed.headingEdit.replace('{id}', feedId) })).toBeVisible();
    await expect(page.getByTestId('source-shop-fixed')).toContainText(SHOP.name);
    await expect(page.locator('#source-shop')).toHaveCount(0);
    await expect(page.locator('#source-network option:checked')).toHaveText(NETWORK.name);
    await expect(page.getByTestId('source-domain')).toContainText(HOST);
    const address = page.getByLabel(form.Feed.urlLabelEdit, { exact: true });
    await expect(address).toHaveValue('');
    await expect(page.getByText(form.Feed.urlHintEdit)).toBeVisible();
    // The warning is above the field, and the field is described by it.
    const warning = page.getByTestId('feed-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(form.Feed.warningTitle);
    expect((await warning.boundingBox())!.y).toBeLessThan((await address.boundingBox())!.y);
    await expect(address).toHaveAttribute('aria-describedby', /feed-warning/);

    // Focus order: back link, network, address, Cancelar, Guardar cambios (check 31).
    await page.getByTestId('form-back').focus();
    for (const expected of ['#source-network', '#source-address', '[data-testid="form-cancel"]', '[data-testid="form-submit"]']) {
      await page.keyboard.press('Tab');
      await expect(page.locator(expected)).toBeFocused();
    }

    // An empty address keeps the address and the approval (AC 19).
    await page.getByTestId('form-submit').click();
    await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=feed-guardado$/);
    await expect(page.getByTestId('admin-notice')).toHaveText(copy.noticeFeedSaved);
    const feed = shopGroup(page, SHOP.name).getByTestId(`source-feed-${feedId}`);
    await expect(feed.getByTestId('source-tag')).toHaveText(copy.feedApproved);
    await expect(feed.getByTestId('source-value')).toContainText(HOST);
  });

  test('typing a new address on an approved feed asks first, Cancelar returns focus, and confirming leaves the feed unapproved', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`${SOURCES}/feed/${feedId}/editar`);
    const address = page.getByLabel(form.Feed.urlLabelEdit, { exact: true });
    await address.fill(URL_SECOND);
    await page.getByTestId('form-submit').click();

    const confirm = page.getByTestId('feed-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(form.Feed.confirmTitle.replace('{id}', feedId));
    await expect(confirm).toContainText(form.Feed.confirmBody);
    await expect(page.getByTestId('source-cancel')).toBeFocused();
    // Nothing was written yet.
    expect(page.url()).toMatch(/\/editar\/?$/);

    await page.getByTestId('source-cancel').click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId('form-submit')).toBeFocused();

    await page.getByTestId('form-submit').click();
    await expect(confirm).toBeVisible();
    await page.getByTestId('source-confirm-yes').click();

    await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=feed-sin-aprobar$/);
    await expect(page.getByTestId('admin-notice')).toHaveText(copy.noticeFeedUnapproved);
    const feed = shopGroup(page, SHOP.name).getByTestId(`source-feed-${feedId}`);
    await expect(feed.getByTestId('source-tag')).toHaveText(copy.feedNotApproved);
    await expect(feed.getByTestId('source-value')).toContainText(HOST_AFTER);
    await expect(feed.getByTestId('source-value')).not.toContainText(HOST);
    await expectNoLeak(page, 'after replacing the address');

    // The unapproved feed has no warning on its edit form.
    await page.goto(`${SOURCES}/feed/${feedId}/editar`);
    await expect(page.getByTestId('feed-warning')).toHaveCount(0);
    await expect(page.getByTestId('source-domain')).toContainText(HOST_AFTER);
  });

  test('the feed form refuses each bad address next to its field, leaves it empty and repeats nothing', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`${SOURCES}/feed/nuevo`);
    const submit = page.getByTestId('form-submit');
    const address = page.getByLabel(form.Feed.urlLabelNew, { exact: true });

    // Nothing chosen and nothing typed.
    await submit.click();
    await expect(page.locator('#source-shop-error')).toHaveText(errors.shopRequired);
    await expect(page.locator('#source-network-error')).toHaveText(errors.networkRequired);
    await expect(page.locator('#source-address-error')).toHaveText(errors.urlRequired);

    await page.getByLabel(form.Feed.shopLabel, { exact: true }).selectOption({ label: SHOP.name });
    await page.getByLabel(form.Feed.networkLabel, { exact: true }).selectOption({ label: NETWORK.name });

    const cases: [string, string][] = [
      [`http://${HOST}/x?apikey=${KEY}`, errors.urlInvalid],
      [`https://user:${KEY}@${HOST}/x`, errors.urlCredentials],
      [`${URL_SECOND}`, errors.urlDuplicate],
      ['demo-feed:feed-uno.csv', errors.urlInvalid],
    ];
    for (const [typed, message] of cases) {
      // A refusal may reset the choices (see the last test of this file): choose them again.
      await page.getByLabel(form.Feed.shopLabel, { exact: true }).selectOption({ label: SHOP.name });
      await page.getByLabel(form.Feed.networkLabel, { exact: true }).selectOption({ label: NETWORK.name });
      await address.fill(typed);
      await submit.click();
      await expect(page.locator('#source-address-error'), typed).toHaveText(message);
      await expect(address, typed).toHaveValue('');
      await expect(address, typed).toHaveAttribute('aria-invalid', 'true');
      await expect(address).toHaveAttribute('aria-describedby', /source-address-error/);
      for (const leak of [KEY, 'apikey', 'user:']) expect(await page.content(), `${typed}: ${leak}`).not.toContain(leak);
    }

    await page.getByLabel(form.Feed.shopLabel, { exact: true }).selectOption({ label: SHOP.name });
    await page.getByLabel(form.Feed.networkLabel, { exact: true }).selectOption({ label: NETWORK.name });
    await address.fill(`https://${HOST}/${'a'.repeat(2100)}`);
    await submit.click();
    await expect(page.locator('#source-address-error')).toContainText(errors.urlTooLong.split('{max}')[0]);
    await expect(address).toHaveValue('');

    // A refusal with only the address field at fault shows the refill hint where there is no own message.
    await page.getByLabel(form.Feed.shopLabel, { exact: true }).selectOption({ label: SHOP.name });
    await address.fill(`https://${HOST}/x`);
    await page.getByLabel(form.Feed.networkLabel, { exact: true }).selectOption({ value: '' });
    await submit.click();
    await expect(page.locator('#source-network-error')).toHaveText(errors.networkRequired);
    await expect(page.locator('#source-address-hint')).toHaveText(form.Feed.refillHintNew);
    await expect(address).toHaveValue('');
  });

  test('a demo feed shows no address field and keeps its network editable; a demo shop and network carry the Demo mark (AC 22, 35)', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(SOURCES);
    const demoFeed = page.getByTestId(/^source-feed-/).filter({ has: page.getByTestId('demo-mark') }).first();
    await expect(demoFeed.getByTestId('source-value')).toContainText(copy.domainNone);
    const href = await demoFeed.getByRole('link', { name: /^Editar feed/ }).getAttribute('href');
    expect(href).toMatch(/\/admin\/tiendas\/feed\/\d+\/editar$/);

    for (const demoName of SHOP_NAMES) {
      await expect(shopGroup(page, demoName).getByTestId(/^source-shop-/).getByTestId('demo-mark')).toHaveCount(1);
    }
    await expect(page.getByTestId('networks-list').locator('li').filter({ hasText: 'demo' }).getByTestId('demo-mark').first()).toBeVisible();
    // The shop this spec made is not a demo shop, nor is its network.
    await expect(shopGroup(page, SHOP.name).getByTestId('demo-mark')).toHaveCount(0);
    await expect(page.getByTestId('networks-list').locator('li').filter({ hasText: NETWORK.slug }).getByTestId('demo-mark')).toHaveCount(0);

    await page.goto(href!);
    await expect(page.getByTestId('feed-demo-hint')).toHaveText(form.Feed.demoUrlHint);
    await expect(page.locator('input[name="url"]')).toHaveCount(0);
    await expect(page.getByTestId('feed-warning')).toHaveCount(0);
    await expect(page.locator('#source-network')).toBeVisible();
    await expect(page.getByTestId('source-domain')).toContainText(copy.domainNone);
  });

  test('a public page and the sitemap are as they were, and set no cookie (AC 44)', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expectNoSetCookie(sitemap);
    expect(await sitemap.text()).toBe(publicBefore.sitemap);
    const product = await request.get('/producto/demo-filtro-de-aceite-oc-1234');
    expectNoSetCookie(product);
    expect(stripScripts(await product.text())).toBe(publicBefore.product);
    // A page of the new shop is not public: nothing of it was registered with the catalogue.
    for (const path of [`/buscar?q=${SHOP.slug}`, `/categoria/${SHOP.slug}`]) {
      expect(await (await request.get(path)).text(), path).not.toContain(SHOP.name);
    }
  });

  test('the shop this spec approved is disabled again, so no e2e shop is left approved', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(SOURCES);
    const row = shopGroup(page, SHOP.name).getByTestId(/^source-shop-/);
    await row.getByTestId('source-disable').click();
    await row.getByTestId('source-confirm-yes').click();
    await expect(row.getByTestId('source-done')).toHaveText(copy.doneShopDisabled);
    await expect(row.getByTestId('source-tag')).toHaveText(copy.shopNotApproved);
  });
});


test.describe('the longest values the validation accepts reflow at 390 and 1280 (AC 42)', () => {
  const widths = [390, 1280];
  const routes: Record<string, string> = {};

  test('creates a 120-character network and shop, a 64-character slug and a feed on a 253-character host', async ({ page }) => {
    await signInAsAdmin(page);
    // Found on a later run (and reset in beforeAll); created through the forms only when missing.
    if (!networkExists(LONG_NETWORK_SLUG)) await createNetwork(page, LONG_NAME, LONG_NETWORK_SLUG);
    if (!shopExists(LONG_SHOP_SLUG)) await createShop(page, LONG_NAME, LONG_SHOP_SLUG);
    if (!feedExists(LONG_SHOP_SLUG)) await createFeed(page, LONG_SHOP_SLUG, LONG_NAME, LONG_URL);
    await page.goto(SOURCES);
    const group = shopGroupBySlug(page, LONG_SHOP_SLUG);
    await expect(group.getByTestId(/^source-feed-/).getByTestId('source-value')).toContainText(LONG_HOST);
    routes.shop = (await group.getByRole('link', { name: /^Editar tienda/ }).getAttribute('href'))!;
    routes.feed = (await group.getByRole('link', { name: /^Editar feed/ }).getAttribute('href'))!;
    routes.network = (await page
      .getByTestId('networks-list')
      .locator('li')
      .filter({ hasText: LONG_NETWORK_SLUG })
      .getByRole('link', { name: /^Editar red/ })
      .getAttribute('href'))!;
    routes.newFeed = `${SOURCES}/feed/nuevo?tienda=${routes.shop.split('/')[4]}`;
  });

  for (const width of widths) {
    test(`the list and the six forms show no sideways scroll and no cut text at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await signInAsAdmin(page);
      const pages = [SOURCES, `${SOURCES}/red/nueva`, `${SOURCES}/tienda/nueva`, routes.newFeed, routes.network, routes.shop, routes.feed];
      for (const path of pages) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await reflowProblems(page), `${path} at ${width}`).toEqual([]);
      }
    });
  }

  test('every link, field and select of the forms is at least 44px tall at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAsAdmin(page);
    for (const path of [`${SOURCES}/feed/nuevo`, routes.network, routes.feed]) {
      await page.goto(path);
      const small = await page
        .locator('main a, main input:not([type="hidden"]), main select, main button')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => ({ id: node.getAttribute('data-testid') ?? node.id ?? node.tagName, height: node.getBoundingClientRect().height }))
            .filter((item) => item.height > 0 && item.height < 43.5),
        );
      expect(small, path).toEqual([]);
    }
  });
});

// Last on purpose: serial mode skips what follows a failure, and this one reads a choice that the
// UX spec says a refusal keeps (05-ux § 6 "Refused", check 25), which the form does not keep yet.
test.describe('the choices stay after a refusal (05-ux § 6, check 25)', () => {
  test('the shop and network selects keep what was chosen, and the typed name stays', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`${SOURCES}/feed/nuevo`);
    await page.getByLabel(form.Feed.shopLabel, { exact: true }).selectOption({ label: SHOP.name });
    await page.getByLabel(form.Feed.networkLabel, { exact: true }).selectOption({ label: NETWORK.name });
    await page.getByLabel(form.Feed.urlLabelNew, { exact: true }).fill(`http://${HOST}/x?apikey=${KEY}`);
    await page.getByTestId('form-submit').click();
    await expect(page.locator('#source-address-error')).toHaveText(errors.urlInvalid);
    await expect(page.locator('#source-shop option:checked')).toHaveText(SHOP.name);
    await expect(page.locator('#source-network option:checked')).toHaveText(NETWORK.name);
  });
});

// #339 (0006 rule 12): journey J9, an admin registers a network, a shop and an https feed through the forms and
// approves them, and nothing of it reaches the public site. Added beside the tests it replaces. It signs in once
// per worker (`adminTest`), uses rows of its own (a fresh e2e database has none, and `releaseRows()` above matches
// their slug and host patterns), and ends with the feed and the shop disabled again, so nothing is left approved
// for the next `import-feeds`.
adminTest.describe('registering and approving a feed journey (#339)', () => {
  const JOURNEY = {
    network: { name: 'Red e2e viaje', slug: 'e2e-red-viaje' },
    shop: { name: 'Tienda e2e viaje', slug: 'e2e-tienda-viaje' },
    host: 'e2e-feeds-viaje.example',
    url: 'https://e2e-feeds-viaje.example/privado/KEY-E2E-VIAJE/viaje-datos.csv?token=TOKEN-E2E-VIAJE',
  };

  adminTest('J9: network, shop and feed through the forms; both approved and disabled again; the public site unchanged', async ({
    page,
    publicRequest: request,
  }) => {
    const sitemapBefore = await (await request.get('/sitemap.xml')).text();
    const productBefore = stripScripts(await (await request.get('/producto/demo-filtro-de-aceite-oc-1234')).text());

    // The network, from the toolbar.
    await page.goto(SOURCES);
    await page.getByRole('link', { name: copy.addNetwork, exact: true }).click();
    await page.getByLabel(form.nameLabel, { exact: true }).fill(JOURNEY.network.name);
    await page.getByLabel(form.slugLabel, { exact: true }).fill(JOURNEY.network.slug);
    await page.getByRole('button', { name: form.Network.submitNew, exact: true }).click();
    await expect(page.getByText(copy.noticeNetworkCreated, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: JOURNEY.network.name, exact: true })).toBeVisible();

    // The shop: it starts not approved and with no feed.
    await page.getByRole('link', { name: copy.addShop, exact: true }).click();
    await page.getByLabel(form.nameLabel, { exact: true }).fill(JOURNEY.shop.name);
    await page.getByLabel(form.slugLabel, { exact: true }).fill(JOURNEY.shop.slug);
    await page.getByRole('button', { name: form.Shop.submitNew, exact: true }).click();
    await expect(page.getByText(copy.noticeShopCreated, { exact: true })).toBeVisible();
    const shop = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { level: 2, name: JOURNEY.shop.name, exact: true }),
    });
    await expect(shop.getByText(copy.shopNotApproved, { exact: true })).toBeVisible();
    await expect(shop.getByText(copy.shopNoFeeds, { exact: true })).toBeVisible();

    // The feed, from the shop's own link: it starts not approved, and the page shows the host and nothing else of the address.
    await shop.getByRole('link', { name: copy.addFeedName.replace('{shop}', JOURNEY.shop.name), exact: true }).click();
    await page.getByLabel(form.Feed.networkLabel, { exact: true }).selectOption({ label: JOURNEY.network.name });
    await page.getByLabel(form.Feed.urlLabelNew, { exact: true }).fill(JOURNEY.url);
    await page.getByRole('button', { name: form.Feed.submitNew, exact: true }).click();
    await expect(page.getByText(copy.noticeFeedCreated, { exact: true })).toBeVisible();
    const feedHeading = shop.getByRole('heading', { level: 3 });
    const feedId = /\d+/.exec(await feedHeading.innerText())?.[0] ?? '';
    expect(feedId).not.toBe('');
    await expect(shop.getByText(copy.feedNotApproved, { exact: true })).toBeVisible();
    await expect(shop).toContainText(JOURNEY.host);
    // A fresh load of the list: what Next sent for the form page is not part of it.
    await page.goto(SOURCES);
    const content = await page.content();
    for (const secret of ['KEY-E2E-VIAJE', 'TOKEN-E2E-VIAJE', '/privado/', 'viaje-datos.csv']) expect(content, secret).not.toContain(secret);

    // Two separate approvals, each one a press that says what it saved.
    await shop.getByRole('button', { name: copy.shopApproveName.replace('{shop}', JOURNEY.shop.name), exact: true }).click();
    await expect(shop.getByText(copy.doneShopApproved, { exact: true })).toBeVisible();
    await shop
      .getByRole('button', {
        name: copy.feedApproveName.replace('{id}', feedId).replace('{shop}', JOURNEY.shop.name),
        exact: true,
      })
      .click();
    await expect(shop.getByText(copy.doneFeedApproved, { exact: true })).toBeVisible();
    await expect(shop.getByText(copy.feedApproved, { exact: true })).toBeVisible();

    // Approving publishes nothing by itself: no import has run, so the public pages are as they were.
    const sitemap = await request.get('/sitemap.xml');
    expectNoSetCookie(sitemap);
    expect(await sitemap.text()).toBe(sitemapBefore);
    expect(stripScripts(await (await request.get('/producto/demo-filtro-de-aceite-oc-1234')).text())).toBe(productBefore);
    expect(await (await request.get(`/buscar?q=${JOURNEY.shop.slug}`)).text()).not.toContain(JOURNEY.shop.name);

    // Disable the feed, then the shop, each behind its confirmation: nothing stays approved.
    await shop
      .getByRole('button', {
        name: copy.feedDisableName.replace('{id}', feedId).replace('{shop}', JOURNEY.shop.name),
        exact: true,
      })
      .click();
    await shop.getByRole('button', { name: copy.confirmFeedYes, exact: true }).click();
    await expect(shop.getByText(copy.doneFeedDisabled, { exact: true })).toBeVisible();
    await shop.getByRole('button', { name: copy.shopDisableName.replace('{shop}', JOURNEY.shop.name), exact: true }).click();
    await shop.getByRole('button', { name: copy.confirmShopYes, exact: true }).click();
    await expect(shop.getByText(copy.doneShopDisabled, { exact: true })).toBeVisible();
    await expect(shop.getByText(copy.shopNotApproved, { exact: true })).toBeVisible();
  });
});
