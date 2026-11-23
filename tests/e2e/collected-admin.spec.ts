import { expect, test, type Browser, type Page, type Request } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { CATALOGUE_FILE_KINDS, CATALOGUE_FILE_NAME_MAX } from '../../src/server/catalogue-file-name';
import { signInAs } from '../support/admin-e2e';
import { startIsolatedApp, type IsolatedApp } from '../support/isolated-app';
import { expectNoSetCookie, stripScripts } from '../support/page-checks';

// S12.2 T-12.2.4 (decision 0017), ACs 1, 4 to 8, 50 and 04-ux § Checks 1 to 24 in a browser, on the admin
// screens: the third source of the feed form, a collected feed in both lists, the edit page with its warning
// and its rename confirm, and no sign of it on a public page. Desktop width only, function and copy (admin
// screens are not checked at phone width). The writers and the actions with no session or another origin are
// collected-feed-admin.test.ts; this spec is what the browser adds. It runs on an app container and a
// database of its own (tests/support/isolated-app.ts), so the feeds it registers and approves can never be
// counted by a spec that reads the development database in parallel, and nothing is left behind.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const EMAIL = 'e2e-collected-admin@example.test';
const PASSWORD = 'e2e-collected-password-1';

const form = messages.Admin.Form;
const feedCopy = form.Feed;
const errors = form.Errors;
const sources = messages.Admin.Sources;
const KINDS = new Intl.ListFormat('es-ES', { type: 'disjunction' }).format([...CATALOGUE_FILE_KINDS]);

const SHOP = { slug: 'e2e-tienda-uno', name: 'Tienda uno e2e' };
const NAME = 'precios-e2e.csv';
const RENAMED = 'precios-e2e-b.csv';
const HAND = 'escrito-e2e.csv';

let app: IsolatedApp;
let shopId = 0;
let feedId = 0;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  app = await startIsolatedApp('collected-admin.spec.ts');
  app.createAdmin(EMAIL, PASSWORD);
  app.psql(`insert into shops (slug, name, is_approved) values ('${SHOP.slug}', '${SHOP.name}', true)`);
  shopId = Number(app.psqlScalar(`select id from shops where slug = '${SHOP.slug}'`));
  // A hand-written file feed beside it, so the two kinds are read side by side (UX check 14).
  app.psql(`insert into feeds (shop_id, source_type, url, is_approved, is_demo) values (${shopId}, 'catalogue_file', '${HAND}', false, false)`);
});
test.afterAll(() => {
  app?.stop();
});

const feedRow = (feed: number): string =>
  app.psqlScalar(`select source_type || '|' || url || '|' || is_approved || '|' || coalesce(network_id::text, '') || '|' || is_demo from feeds where id = ${feed}`);
const handId = (): number => Number(app.psqlScalar(`select id from feeds where url = '${HAND}'`));

/** A signed-in page of its own context, whose base URL is the isolated app (the config's base URL is the Compose one). */
async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: app.origin });
  const page = await context.newPage();
  await signInAs(page, EMAIL, PASSWORD);
  return page;
}

const newFeedUrl = () => `/admin/tiendas/feed/nuevo?tienda=${shopId}`;

test.describe('the feed form: a third source (UX checks 1 to 11)', () => {
  test('lists exactly three origins in order, the https one first and the default, never the collected one (checks 1, 2)', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(newFeedUrl());
    await page.waitForLoadState('networkidle');

    const labels = await page.locator('#source-origin option').allTextContents();
    expect(labels).toEqual([feedCopy.sourceOptionNetwork, feedCopy.sourceOptionFile, feedCopy.sourceOptionCollected]);
    const values = await page.locator('#source-origin option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(values).toEqual(['affiliate_network', 'catalogue_file', 'collected_file']);
    // The form opens on the https source, or on the catalogue file when no network exists (UX § States): never on the collected one.
    await expect(page.locator('#source-origin')).toHaveValue(/^(affiliate_network|catalogue_file)$/);
  });

  test('the collected source shows its hint, an Info block, its own label and hint, and no network or address (checks 3 to 6)', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(newFeedUrl());
    await page.waitForLoadState('networkidle');
    await page.locator('#source-origin').selectOption('collected_file');

    await expect(page.locator('#source-origin-hint')).toHaveText(feedCopy.sourceHintCollected);
    await expect(page.locator('#source-network')).toHaveCount(0);
    await expect(page.locator('#source-address')).toHaveCount(0);
    await expect(page.getByTestId('missing-network')).toHaveCount(0);
    const info = page.getByTestId('collected-info');
    await expect(info).toContainText(feedCopy.collectedInfoTitle);
    await expect(info).toContainText(feedCopy.collectedInfoBody);
    await expect(page.locator('label[for="source-file"]')).toHaveText(feedCopy.fileLabelCollected);
    await expect(page.locator('#source-file-hint')).toContainText(feedCopy.fileHintNewCollected.split('{kinds}')[0]);
    await expect(page.locator('#source-file-hint')).toContainText(KINDS);
    // The catalogue source points at the collected one, and shows no Info block.
    await page.locator('#source-origin').selectOption('catalogue_file');
    await expect(page.locator('#source-origin-hint')).toHaveText(feedCopy.sourceHintFile);
    await expect(page.getByTestId('collected-info')).toHaveCount(0);
  });

  test('typed text never crosses the switch between the two file origins, either way (check 8)', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(newFeedUrl());
    await page.waitForLoadState('networkidle');
    const origin = page.locator('#source-origin');
    const file = page.locator('#source-file');

    await origin.selectOption('catalogue_file');
    await file.fill('escrito-a-mano-e2e.csv');
    await origin.selectOption('collected_file');
    await expect(file).toHaveValue('');
    await file.fill('recopilado-e2e.csv');
    await origin.selectOption('catalogue_file');
    await expect(file).toHaveValue('');
    await expect(page).toHaveURL(/\/admin\/tiendas\/feed\/nuevo\?tienda=\d+$/);
  });

  test('each bad name is refused next to the field, with its own message, the field empty and the source kept; nothing is repeated (checks 9, 10)', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(newFeedUrl());
    await page.waitForLoadState('networkidle');
    const origin = page.locator('#source-origin');
    const file = page.locator('#source-file');
    const message = page.locator('#source-file-error');
    await origin.selectOption('collected_file');

    await page.getByTestId('form-submit').click();
    await expect(message).toHaveText(errors.fileRequired);
    await expect(origin).toHaveValue('collected_file');
    await expect(page.locator('#source-file-hint')).toHaveText(feedCopy.fileRefillNew);

    const cases: [string, string][] = [
      ['carpeta-e2e/x.csv', errors.fileNotAName],
      ['https://anfitrion-e2e.example/a.csv', errors.fileNotAName],
      ['notas-e2e.txt', errors.fileWrongKind.replace('{kinds}', KINDS)],
      [`${'x'.repeat(CATALOGUE_FILE_NAME_MAX)}.csv`, errors.fileTooLong.replace('{max}', String(CATALOGUE_FILE_NAME_MAX))],
    ];
    for (const [typed, expected] of cases) {
      await file.fill(typed);
      await page.getByTestId('form-submit').click();
      await expect(message, typed).toHaveText(expected);
      await expect(file, typed).toHaveValue('');
      await expect(origin, typed).toHaveValue('collected_file');
      if (typed.length < 60) expect(stripScripts(await page.content()), `the page repeats ${typed}`).not.toContain(typed);
    }
    expect(app.psqlScalar(`select count(*) from feeds where source_type = 'collected_file'`)).toBe('0');
  });

  test('a valid name creates an unapproved, non-demo feed with no network and shows it as a collected file (checks 12, 13, 14)', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(newFeedUrl());
    await page.waitForLoadState('networkidle');
    await page.locator('#source-origin').selectOption('collected_file');
    await page.locator('#source-file').fill(NAME);
    await page.getByTestId('form-submit').click();

    await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=feed-creado$/);
    await expect(page.getByTestId('admin-notice')).toHaveText(sources.noticeFeedCreated);
    feedId = Number(app.psqlScalar(`select id from feeds where url = '${NAME}'`));
    expect(feedId).toBeGreaterThan(0);
    expect(feedRow(feedId)).toBe(`collected_file|${NAME}|false||false`);

    const row = page.getByTestId(`source-feed-${feedId}`);
    await expect(row.getByTestId('source-tag')).toHaveText(sources.feedNotApproved);
    await expect(row).toContainText(sources.feedMetaCollected);
    await expect(row.getByTestId('source-value')).toHaveText(`${sources.fileLabel} ${NAME}`);
    for (const absent of [sources.feedMetaFile, sources.feedMetaUpload, 'Red:']) await expect(row).not.toContainText(absent);
    await expect(row.getByTestId('demo-mark')).toHaveCount(0);

    // The hand-written feed of the same shop still reads as one.
    const hand = page.getByTestId(`source-feed-${handId()}`);
    await expect(hand).toContainText(sources.feedMetaFile);
    await expect(hand).not.toContainText(sources.feedMetaCollected);
  });

  test('the same name again, or the name a hand-written feed of the shop has, is the duplicate message, without the name (check 11)', async ({ browser }) => {
    const page = await signedIn(browser);
    for (const name of [NAME, HAND]) {
      await page.goto(newFeedUrl());
      await page.waitForLoadState('networkidle');
      await page.locator('#source-origin').selectOption('collected_file');
      await page.locator('#source-file').fill(name);
      await page.getByTestId('form-submit').click();
      const message = page.locator('#source-file-error');
      await expect(message, name).toHaveText(errors.fileDuplicate);
      expect(await message.innerText()).not.toContain(name);
    }
    expect(app.psqlScalar(`select count(*) from feeds where shop_id = ${shopId}`)).toBe('2');
  });
});

test.describe('the edit page and a changed file name (UX checks 16 to 19; ACs 5, 6)', () => {
  test('shows the shop and the origin as text, no source select, the Info block and the stored name; no warning while unapproved (check 16)', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/tiendas/feed/${feedId}/editar`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('source-shop-fixed')).toContainText(SHOP.name);
    await expect(page.getByTestId('source-origin-fixed')).toContainText(feedCopy.sourceFixedCollected);
    await expect(page.locator('#source-origin')).toHaveCount(0);
    await expect(page.locator('#source-shop')).toHaveCount(0);
    await expect(page.getByTestId('collected-info')).toContainText(feedCopy.collectedInfoTitle);
    await expect(page.locator('label[for="source-file"]')).toHaveText(feedCopy.fileLabelCollected);
    await expect(page.locator('#source-file')).toHaveValue(NAME);
    await expect(page.getByTestId('feed-warning')).toHaveCount(0);
  });

  test('an approved feed warns before anything is typed; the same name saves with no panel and stays approved (check 17)', async ({ browser }) => {
    app.psql(`update feeds set is_approved = true where id = ${feedId}`);
    const page = await signedIn(browser);
    await page.goto(`/admin/tiendas/feed/${feedId}/editar`);
    await page.waitForLoadState('networkidle');

    const warning = page.getByTestId('feed-warning');
    await expect(warning).toContainText(feedCopy.fileWarningTitle);
    await expect(warning).toContainText(feedCopy.fileWarningBodyCollected);

    await page.getByTestId('form-submit').click();
    await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=feed-guardado$/);
    await expect(page.getByTestId('admin-notice')).toHaveText(sources.noticeFeedSaved);
    expect(feedRow(feedId)).toBe(`collected_file|${NAME}|true||false`);
  });

  test('a new name opens the panel, Cancelar writes nothing, and confirming leaves it unapproved, still collected, with no source in the post (checks 18, 19; ACs 5, 6)', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/tiendas/feed/${feedId}/editar`);
    await page.waitForLoadState('networkidle');
    const posts: Request[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/admin/tiendas/feed/')) posts.push(request);
    });

    await page.locator('#source-file').fill(RENAMED);
    await page.getByTestId('form-submit').click();
    const confirm = page.getByTestId('feed-confirm');
    await expect(confirm).toContainText(feedCopy.fileConfirmTitle.replace('{id}', String(feedId)));
    expect(feedRow(feedId)).toBe(`collected_file|${NAME}|true||false`);

    await page.getByTestId('source-cancel').click();
    await expect(confirm).toHaveCount(0);
    expect(feedRow(feedId)).toBe(`collected_file|${NAME}|true||false`);

    await page.getByTestId('form-submit').click();
    await page.getByTestId('source-confirm-yes').click();
    await expect(page).toHaveURL(/\/admin\/tiendas\?aviso=feed-sin-aprobar$/);
    await expect(page.getByTestId('admin-notice')).toHaveText(sources.noticeFeedUnapproved);
    expect(feedRow(feedId)).toBe(`collected_file|${RENAMED}|false||false`);

    const row = page.getByTestId(`source-feed-${feedId}`);
    await expect(row.getByTestId('source-tag')).toHaveText(sources.feedNotApproved);
    await expect(row).toContainText(sources.feedMetaCollected);
    // The post carried the id and the name, and no source: a feed keeps its kind (AC 5).
    expect(posts.length, 'the form posts were captured').toBeGreaterThan(0);
    for (const post of posts) expect(post.postData() ?? '').not.toMatch(/collected_file|name="(?:\d+_)?source"/);
  });
});

test.describe('the category screen and the paused state (UX checks 20 to 23)', () => {
  test('a collected feed section carries its meta, its file name, its note and the never-imported sentence; a hand-written one carries neither the meta nor the note (checks 20, 21)', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto('/admin/categorias');

    const section = page.getByTestId(`category-feed-${feedId}`);
    await expect(section.getByTestId('category-feed-domain')).toHaveText(`${sources.fileLabel} ${RENAMED}`);
    await expect(section.getByTestId('category-feed-meta')).toHaveText(sources.feedMetaCollected);
    await expect(section.getByTestId('category-feed-note').last()).toHaveText(messages.Admin.Categories.collectedNote);
    await expect(section.getByTestId('category-feed-statement')).toHaveText(messages.Admin.Categories.feedNeverImportedFile);

    const hand = page.getByTestId(`category-feed-${handId()}`);
    await expect(hand.getByTestId('category-feed-meta')).toHaveText(sources.feedMetaFile);
    await expect(hand).not.toContainText(messages.Admin.Categories.collectedNote);
  });

  test('an approved collected feed under an unapproved shop reads "Aprobado, en pausa" with the existing controls (check 22)', async ({ browser }) => {
    app.psql(`update feeds set is_approved = true where id = ${feedId}`);
    app.psql(`update shops set is_approved = false where id = ${shopId}`);
    const page = await signedIn(browser);
    await page.goto('/admin/tiendas');

    const row = page.getByTestId(`source-feed-${feedId}`);
    await expect(row.getByTestId('source-tag')).toHaveText(sources.feedPaused);
    await expect(row.getByTestId('source-disable')).toHaveCount(1);
    app.psql(`update feeds set is_approved = false where id = ${feedId}`);
    app.psql(`update shops set is_approved = true where id = ${shopId}`);
  });

  test('no admin screen shows a folder, a path or the flag name (check 15), a 100-character name wraps inside the box (check 23)', async ({ browser }) => {
    const long = `${'a'.repeat(CATALOGUE_FILE_NAME_MAX - 4)}.csv`;
    app.psql(`insert into feeds (shop_id, source_type, url, is_approved, is_demo) values (${shopId}, 'collected_file', '${long}', false, false)`);
    const page = await signedIn(browser);
    for (const path of ['/admin/tiendas', '/admin/categorias', `/admin/tiendas/feed/${feedId}/editar`, newFeedUrl()]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const text = stripScripts(await page.content());
      expect(text, path).not.toMatch(/collected-files|catalogue-files|LOCAL_COLLECTED_DATA|\/app\/|[A-Za-z]:\\/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    }
    await page.goto('/admin/tiendas');
    await expect(page.getByText(long, { exact: false }).first()).toBeVisible();
  });
});

test.describe('nothing public changes (UX check 24, AC 50, guardrail 3)', () => {
  test('the home, a category, search and a product page say nothing about collected files or a local flag, and set no cookie', async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: app.origin });
    try {
      const productSlug = app.psqlScalar('select slug from products order by id limit 1');
      const categorySlug = app.psqlScalar('select slug from categories where parent_id is not null order by position, id limit 1');
      for (const path of ['/', `/producto/${productSlug}`, `/categoria/${categorySlug}`, '/buscar?q=filtro']) {
        const response = await request.get(path);
        expect(response.status(), path).toBe(200);
        expectNoSetCookie(response);
        expect(stripScripts(await response.text()), path).not.toMatch(/recopilad|solo para uso local|ajuste local/i);
      }
    } finally {
      await request.dispose();
    }
  });

  test('an anonymous request for the edit page of a collected feed is sent to sign-in, with nothing from the page', async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: app.origin });
    try {
      const response = await request.get(`/admin/tiendas/feed/${feedId}/editar`, { maxRedirects: 0 });
      expect(response.status()).toBeGreaterThanOrEqual(300);
      expect(response.status()).toBeLessThan(400);
      expect(response.headers().location).toContain('/admin/acceso');
      expect(response.headers()['set-cookie']).toBeUndefined();
      expect(await response.text()).not.toContain(RENAMED);
    } finally {
      await request.dispose();
    }
  });
});
