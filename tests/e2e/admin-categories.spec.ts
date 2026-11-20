import { expect, test, type Locator, type Page } from '@playwright/test';
import { createTranslator } from 'use-intl/core';

import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import messages from '../../messages/es-ES.json';
import { createAdminWithCommand, psql, psqlScalar, signInAs } from '../support/admin-e2e';
import { expectNoSetCookie, stripScripts } from '../support/page-checks';

// US-4.2 against the Compose stack, at desktop width only (admin screens are not checked at phone
// width): from sign-in to a mapping saved, changed, marked outside scope and removed, with the notice
// before a removal, the success and refusal lines, the keyboard and the labels.
//
// The spec works on a feed of its own (one shop, two feeds, five products) and never touches the
// demo mappings or demo products, which other specs depend on (D-5). Its rows are a FIXED set, found
// again on every run and put back to their starting state (no record, no category, nothing approved),
// so repeated runs add no row. The feed stays NOT approved for the whole spec, on purpose: the
// importer reads every approved feed, and one approved here would change `entrypoint.spec.ts`'s feed
// count in a parallel worker. That makes the public side of guardrail 1 the thing this spec shows
// end to end (a mapping on an unapproved feed publishes nothing). That a removal takes an approved
// feed's product off every public reader at once is proved in integration, with the real readers
// (category-mapping-writer.test.ts, AC 31). It owns its own admin account.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const EMAIL = 'e2e-categories-admin@example.test';
const PASSWORD = 'e2e-categories-password-1';

const copy = messages.Admin.Categories;
const t = createTranslator({ locale: 'es-ES', messages, namespace: 'Admin.Categories' });
const sources = messages.Admin.Sources;
const form = messages.Admin.Form;

const SHOP = { slug: 'e2e-cat-tienda', name: 'Tienda e2e categorias' };
const KEY = 'KEY-E2E-CATEGORIAS';
const HOST = 'e2e-categorias.example';
const URL_MAIN = `https://${HOST}:8443/privado/${KEY}/catalogo.csv?apikey=${KEY}#frag-${KEY}`;
const URL_EMPTY = 'https://e2e-categorias-vacia.example/catalogo.csv';
const LEAKS = [KEY, 'apikey', ':8443', '/privado/', 'catalogo.csv', 'frag-', `https://${HOST}`, 'https://e2e-categorias-vacia'];

const UNO = 'Filtros e2e'; // two products
const MINUSCULAS = 'filtros e2e'; // the same words in lower case: a different category (D-6)
const ACEITES = 'Aceites e2e'; // one product
const PRODUCTS = [
  { slug: 'e2e-cat-uno', category: UNO },
  { slug: 'e2e-cat-dos', category: UNO },
  { slug: 'e2e-cat-tres', category: MINUSCULAS },
  { slug: 'e2e-cat-cuatro', category: ACEITES },
  { slug: 'e2e-cat-cinco', category: null },
];

/** The five choosable categories, named from the fixed tree and never retyped. */
const TARGETS = FIXED_CATEGORY_TREE.children.map((child) => child.name);
const [ACEITE, FILTRO_ACEITE, FILTRO_AIRE] = TARGETS;
const ROOT_NAME = FIXED_CATEGORY_TREE.name;

const count = (statement: string): number => Number(psqlScalar(statement));
const feedIdOf = (url: string): number => count(`select id from feeds where url = '${url}'`);

function releaseRows(): void {
  psql(`update feeds set is_approved = false where url in ('${URL_MAIN}', '${URL_EMPTY}')`);
  psql(`update shops set is_approved = false where slug = '${SHOP.slug}'`);
}

/** Puts the fixed rows in their starting state: created when missing, otherwise reset. */
function resetRows(): void {
  psql(
    `insert into shops (slug, name, is_approved) values ('${SHOP.slug}', '${SHOP.name}', false) on conflict (slug) do update set name = excluded.name, is_approved = false`,
  );
  for (const url of [URL_MAIN, URL_EMPTY]) {
    psql(
      `insert into feeds (shop_id, source_type, url, is_approved, is_demo) select id, 'shop_upload', '${url}', false, false from shops where slug = '${SHOP.slug}' on conflict (shop_id, url) do update set is_approved = false`,
    );
  }
  const feedId = feedIdOf(URL_MAIN);
  psql(`delete from feed_category_mappings where feed_id in (select id from feeds where url in ('${URL_MAIN}', '${URL_EMPTY}'))`);
  PRODUCTS.forEach(({ slug, category }, index) => {
    psql(
      `insert into products (slug, title, category_id, is_hidden) values ('${slug}', 'Producto ${slug}', null, false) on conflict (slug) do update set category_id = null, is_hidden = false`,
    );
    psql(
      `insert into offers (product_id, feed_id, external_id, price_cents, url, feed_category, price_updated_at) select p.id, ${feedId}, 'e2e-cat-${index + 1}', 1000, 'https://affiliate.example/e2e-cat/${index + 1}', ${category === null ? 'null' : `'${category}'`}, now() from products p where p.slug = '${slug}' on conflict (feed_id, external_id) do update set feed_category = excluded.feed_category, is_hidden = false, in_review = false`,
    );
  });
}

/** Demo mappings and the categories of demo products, as one comparable string (they must be left as found). */
function demoFingerprint(): string {
  const mappings = psqlScalar(
    "select count(*) || ':' || coalesce(sum(coalesce(m.category_id, 0)), 0) from feed_category_mappings m join feeds f on f.id = m.feed_id where f.is_demo",
  );
  const products = psqlScalar(
    "select count(p.category_id) || ':' || coalesce(sum(p.category_id), 0) from products p where exists (select 1 from offers o join feeds f on f.id = o.feed_id where o.product_id = p.id and f.is_demo)",
  );
  return `${mappings}|${products}`;
}

let demoBefore = '';
let mainId = 0;
let emptyId = 0;

test.beforeAll(() => {
  createAdminWithCommand(EMAIL, PASSWORD, 'admin categories e2e');
  releaseRows();
  resetRows();
  mainId = feedIdOf(URL_MAIN);
  emptyId = feedIdOf(URL_EMPTY);
  demoBefore = demoFingerprint();
});
test.afterAll(() => {
  psql(`delete from feed_category_mappings where feed_id in (select id from feeds where url in ('${URL_MAIN}', '${URL_EMPTY}'))`);
  psql("update products set category_id = null where slug like 'e2e-cat-%'");
  releaseRows();
});

const SCREEN = '/admin/categorias';

function feedSection(page: Page): Locator {
  return page.getByTestId(`category-feed-${mainId}`);
}

/** The row of one feed category inside this spec's feed. */
function row(page: Page, name: string): Locator {
  return feedSection(page)
    .getByTestId('category-row')
    .filter({ has: page.getByTestId('category-name').getByText(name, { exact: true }) });
}

async function openScreen(page: Page): Promise<void> {
  await page.goto(SCREEN);
  await expect(feedSection(page)).toBeVisible();
  await page.waitForLoadState('networkidle');
}

const recordCount = (): number => count(`select count(*) from feed_category_mappings where feed_id = ${mainId}`);
const categorised = (): number => count("select count(*) from products where slug like 'e2e-cat-%' and category_id is not null");
const categoryOfProduct = (slug: string): string => psqlScalar(`select coalesce(c.name, 'none') from products p left join categories c on c.id = p.category_id where p.slug = '${slug}'`);

test.describe('anonymous visitors (AC 1)', () => {
  test('the screen sends an anonymous request to sign-in, with no cookie and none of its data', async ({ request }) => {
    const raw = await request.get(SCREEN, { maxRedirects: 0 });
    expect(raw.status()).toBeGreaterThanOrEqual(300);
    expect(raw.status()).toBeLessThan(400);
    expect(raw.headers().location).toContain('/admin/acceso');
    expectNoSetCookie(raw);
    const body = stripScripts(await raw.text());
    for (const shown of [copy.heading, SHOP.name, UNO, 'category-feed', 'data-testid="category-row"']) {
      expect(body, shown).not.toContain(shown);
    }
  });
});

test.describe('the screen (AC 1, 9, 10, 11 to 17, 41, 48)', () => {
  test('the nav entry links to it and marks it current; it is noindex and no-store, sets no cookie and has a title', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    const link = page.getByTestId('admin-nav').getByRole('link', { name: messages.Admin.Nav.categories });
    await expect(link).toHaveAttribute('href', SCREEN);
    await link.click();
    await expect(page).toHaveURL(/\/admin\/categorias\/?$/);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: copy.heading })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(messages.Admin.Meta.categoriesTitle.split(' | ')[0]));

    const response = await page.goto(SCREEN);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toMatch(/noindex/);
    expect(response?.headers()['cache-control']).toMatch(/no-store/);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    // Only the entries with a page are links; no other entry gained one.
    const nav = page.getByTestId('admin-nav');
    expect(await nav.locator('a').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))).toEqual(['/admin', '/admin/tiendas', SCREEN]);
  });

  test('says the three rules in order, and names no more of the feed address than its host (AC 10)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    const response = await page.goto(SCREEN);
    const html = (await response?.text()) ?? '';

    await expect(page.getByTestId('categories-rules').locator('p')).toHaveText([copy.intro, copy.rulePublic, copy.ruleRemove]);
    await expect(page.getByTestId('categories-summary')).toBeVisible();
    for (const leak of LEAKS) {
      expect(html, leak).not.toContain(leak);
      expect(await page.content(), `DOM: ${leak}`).not.toContain(leak);
    }
    const section = feedSection(page);
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(t('feedHeading', { id: mainId, shop: SHOP.name }));
    await expect(section.getByTestId('category-feed-domain')).toContainText(HOST);
    await expect(section.getByTestId('category-feed-meta')).toHaveText(sources.feedMetaUpload);
    await expect(section.getByTestId('category-feed-state')).toContainText(sources.feedNotApproved);
    await expect(section.getByTestId('category-feed-note')).toContainText(copy.feedNoteNotApproved);
  });

  test('lists each category with its distinct products and state, not reviewed first, "Filtros" and "filtros" apart (AC 11 to 15)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const section = feedSection(page);

    await expect(section.getByTestId('category-feed-summary')).toHaveText(
      t('feedSummary', { total: 3, totalText: '3', pending: 3, pendingText: '3' }),
    );
    await expect(section.getByTestId('category-group-pending').getByRole('heading', { level: 3 })).toHaveText(
      t('groupPending', { count: '3' }),
    );
    await expect(section.getByTestId('category-group-reviewed')).toHaveCount(0);
    // More products first, then by name: "Aceites e2e" before "filtros e2e", and the two cases never merge.
    await expect(section.getByTestId('category-name')).toHaveText([UNO, ACEITES, MINUSCULAS]);
    await expect(row(page, UNO).getByTestId('category-count')).toHaveText(t('rowCount', { count: 2, countText: '2' }));
    await expect(row(page, MINUSCULAS).getByTestId('category-count')).toHaveText(t('rowCount', { count: 1, countText: '1' }));
    await expect(row(page, ACEITES).getByTestId('category-count')).toHaveText(t('rowCount', { count: 1, countText: '1' }));
    for (const name of [UNO, MINUSCULAS, ACEITES]) await expect(row(page, name).getByTestId('category-tag')).toHaveText(copy.tagPending);
    // The product with an empty category cell is a count and a note, with no row and no control (AC 15).
    await expect(section.getByTestId('category-feed-empty-cells')).toHaveText(t('emptyCellNote', { count: 1, countText: '1' }));
    await expect(section.getByTestId('category-row')).toHaveCount(3);
  });

  test('a feed never imported says so and has no group and no control (AC 16)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const empty = page.getByTestId(`category-feed-${emptyId}`);
    await expect(empty.getByTestId('category-feed-statement')).toHaveText(copy.feedNeverImported);
    await expect(empty.locator('select, button')).toHaveCount(0);
    await expect(empty.getByTestId('category-group-pending')).toHaveCount(0);
  });

  test('a not-reviewed row offers a select of the five categories, never the root, with its two buttons', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const pending = row(page, UNO);

    const select = pending.getByRole('combobox');
    await expect(select).toBeVisible();
    expect(await select.locator('option').allTextContents()).toEqual([copy.selectPrompt, ...TARGETS]);
    expect(await select.locator('option').allTextContents()).not.toContain(ROOT_NAME);
    await expect(select).toHaveValue('');
    await expect(pending.getByTestId('category-assign')).toHaveText(copy.assign);
    await expect(pending.getByTestId('category-mark-outside')).toHaveText(copy.markOutside);
    await expect(pending.getByTestId('category-remove')).toHaveCount(0);
  });

  test('offers no control that approves, disables or hides, anywhere on the screen (AC 41)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const main = page.getByRole('main');
    const ids = await main.getByRole('button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
    const allowed = new Set(['category-assign', 'category-change', 'category-mark-outside', 'category-remove', 'category-unmark']);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(allowed.has(id ?? ''), String(id)).toBe(true);
    await expect(main.locator('input[type="checkbox"], [role="switch"], [data-testid="source-approve"], [data-testid="source-disable"]')).toHaveCount(0);
    await expect(main.getByRole('button', { name: /aprobar|desactivar|ocultar|mostrar/i })).toHaveCount(0);
  });

  test('every select has a visible label and a name of its own, made of the label and its category (AC 48)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const section = feedSection(page);

    for (const name of [UNO, MINUSCULAS, ACEITES]) {
      const select = row(page, name).getByRole('combobox');
      await expect(select).toHaveAccessibleName(`${copy.selectLabel} ${name}`);
      await expect(row(page, name).locator('label', { hasText: copy.selectLabel })).toBeVisible();
      await expect(row(page, name).getByTestId('category-assign')).toHaveAccessibleName(t('assignName', { category: name }));
    }
    await expect(section.getByRole('list', { name: t('rowListLabelPending', { feed: t('feedHeading', { id: mainId, shop: SHOP.name }) }) })).toBeVisible();
  });

  test('every control of a row is reached by Tab in order: the select, then each button (AC 48)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const pending = row(page, ACEITES);

    await pending.getByRole('combobox').focus();
    await expect(pending.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(pending.getByTestId('category-assign')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(pending.getByTestId('category-mark-outside')).toBeFocused();

    // And operable from the keyboard alone: choose a target with the keys and press Enter on the button.
    await pending.getByRole('combobox').focus();
    await page.keyboard.press('ArrowDown');
    await expect(pending.getByRole('combobox')).toHaveValue(/^\d+$/);
  });
});

test.describe('saving (AC 18 to 22, 24, 26 to 33, 40, 49)', () => {
  test('pressing Asignar with the prompt chosen refuses beside the select and saves nothing (AC 48, 49)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const pending = row(page, UNO);

    await pending.getByTestId('category-assign').click();

    const select = pending.getByRole('combobox');
    await expect(select).toHaveAccessibleDescription(copy.errorTargetRequired);
    await expect(select).toHaveAttribute('aria-invalid', 'true');
    await expect(select).toBeFocused();
    await expect(pending.getByTestId('category-tag')).toHaveText(copy.tagPending);
    expect(recordCount()).toBe(0);
    expect(categorised()).toBe(0);
  });

  test('assigning moves the row to Revisadas, says what was done and how many products followed, and moves them with no import', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const section = feedSection(page);
    const pending = row(page, UNO);

    await pending.getByRole('combobox').selectOption({ label: FILTRO_ACEITE });
    await pending.getByTestId('category-assign').click();

    const done = row(page, UNO);
    await expect(done.getByTestId('category-tag')).toHaveText(t('tagMapped', { target: FILTRO_ACEITE }));
    await expect(section.getByTestId('category-group-reviewed').getByTestId('category-name')).toHaveText([UNO]);
    await expect(done.getByTestId('category-result')).toContainText(t('doneMapped', { category: UNO, target: FILTRO_ACEITE }));
    await expect(done.getByTestId('category-result')).toContainText(t('productsMoved', { count: 2, countText: '2', target: FILTRO_ACEITE }));
    await expect(done.getByTestId('category-result')).toBeFocused();
    await expect(section.getByTestId('category-feed-summary')).toHaveText(
      t('feedSummary', { total: 3, totalText: '3', pending: 2, pendingText: '2' }),
    );
    // The select now sits on the stored target, with Cambiar, Marcar fuera and Quitar (04-ux checks 11, 21).
    await expect(done.getByRole('combobox')).toHaveValue(/^\d+$/);
    await expect(done.getByTestId('category-change')).toHaveText(copy.change);
    await expect(done.getByTestId('category-remove')).toHaveText(copy.removeMapped);
    expect(recordCount()).toBe(1);
    expect(categorised()).toBe(2);
    expect(categoryOfProduct('e2e-cat-uno')).toBe(FILTRO_ACEITE);
    expect(categoryOfProduct('e2e-cat-tres')).toBe('none');
  });

  test('a mapping on a feed that is not approved publishes nothing: no product page, nothing on the category page (AC 40)', async ({ request }) => {
    // The previous test left two products with a category on a feed that nobody approved.
    expect(categorised()).toBe(2);
    for (const { slug } of PRODUCTS) {
      const product = await request.get(`/producto/${slug}`);
      expect(product.status(), slug).toBe(404);
    }
    const category = await request.get('/categoria/filtros-de-aceite');
    expect(await category.text()).not.toContain('Producto e2e-cat');
    expect(psqlScalar(`select count(*) from feeds where url = '${URL_MAIN}' and is_approved`)).toBe('0');
  });

  test('changing the target saves with no confirm and moves the products; the same target says nothing changed (AC 19, 24, 28)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);

    await row(page, UNO).getByRole('combobox').selectOption({ label: FILTRO_AIRE });
    await row(page, UNO).getByTestId('category-change').click();
    const changed = row(page, UNO);
    await expect(changed.getByTestId('category-tag')).toHaveText(t('tagMapped', { target: FILTRO_AIRE }));
    await expect(changed.getByTestId('category-result')).toContainText(t('doneMapped', { category: UNO, target: FILTRO_AIRE }));
    await expect(changed.getByTestId('category-result')).toContainText(t('productsMoved', { count: 2, countText: '2', target: FILTRO_AIRE }));
    await expect(page.getByTestId('category-confirm')).toHaveCount(0);
    expect(categoryOfProduct('e2e-cat-dos')).toBe(FILTRO_AIRE);

    await row(page, UNO).getByTestId('category-change').click();
    const same = row(page, UNO);
    await expect(same.getByTestId('category-result')).toHaveText(t('doneUnchanged', { category: UNO }));
    await expect(same.getByTestId('category-tag')).toHaveText(t('tagMapped', { target: FILTRO_AIRE }));
    expect(recordCount()).toBe(1);
  });

  test('marking an assigned row outside scope asks first, says products stop being public, and Cancelar and Escape change nothing (AC 22)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const assigned = row(page, UNO);

    await assigned.getByTestId('category-mark-outside').click();

    const confirm = assigned.getByTestId('category-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(t('confirmOutsideTitle', { category: UNO }));
    await expect(confirm).toContainText(t('confirmBody', { target: FILTRO_AIRE, count: 2, countText: '2' }));
    // Cancelar comes before the confirm and holds the focus.
    const buttons = confirm.getByRole('button');
    await expect(buttons).toHaveText([form.cancel, copy.confirmOutsideYes]);
    await expect(buttons.first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(row(page, UNO).getByTestId('category-mark-outside')).toBeFocused();
    expect(recordCount()).toBe(1);
    expect(categoryOfProduct('e2e-cat-uno')).toBe(FILTRO_AIRE);

    await row(page, UNO).getByTestId('category-remove').click();
    await expect(row(page, UNO).getByTestId('category-confirm')).toContainText(t('confirmRemoveTitle', { category: UNO }));
    await row(page, UNO).getByRole('button', { name: form.cancel }).click();
    await expect(row(page, UNO).getByTestId('category-confirm')).toHaveCount(0);
    await expect(row(page, UNO).getByTestId('category-remove')).toBeFocused();
    expect(recordCount()).toBe(1);
    expect(categorised()).toBe(2);
  });

  test('confirming outside scope clears the products of the old target and says so; the row reads Fuera del catálogo (AC 20, 30)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);

    await row(page, UNO).getByTestId('category-mark-outside').click();
    await row(page, UNO).getByRole('button', { name: copy.confirmOutsideYes }).click();

    const done = row(page, UNO);
    await expect(done.getByTestId('category-tag')).toHaveText(copy.tagOutside);
    await expect(done.getByTestId('category-result')).toContainText(t('doneOutside', { category: UNO }));
    await expect(done.getByTestId('category-result')).toContainText(t('productsCleared', { count: 2, countText: '2' }));
    await expect(done.getByTestId('category-assign')).toBeVisible();
    await expect(done.getByTestId('category-unmark')).toHaveText(copy.removeOutside);
    await expect(done.getByTestId('category-mark-outside')).toHaveCount(0);
    expect(categorised()).toBe(0);
    expect(count(`select count(*) from feed_category_mappings where feed_id = ${mainId} and category_id is null`)).toBe(1);
  });

  test('removing an outside-scope mark returns the row to not reviewed with no confirm and no product count (AC 21, 33)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);

    await row(page, UNO).getByTestId('category-unmark').click();

    const back = row(page, UNO);
    await expect(back.getByTestId('category-tag')).toHaveText(copy.tagPending);
    await expect(back.getByTestId('category-result')).toHaveText(t('doneRemoved', { category: UNO }));
    await expect(page.getByTestId('category-confirm')).toHaveCount(0);
    expect(recordCount()).toBe(0);
  });

  test('marking a not-reviewed row outside scope needs no confirm, and an outside-scope row can be assigned (AC 18, 20)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);

    await row(page, ACEITES).getByTestId('category-mark-outside').click();
    await expect(row(page, ACEITES).getByTestId('category-tag')).toHaveText(copy.tagOutside);
    await expect(page.getByTestId('category-confirm')).toHaveCount(0);

    await row(page, ACEITES).getByRole('combobox').selectOption({ label: ACEITE });
    await row(page, ACEITES).getByTestId('category-assign').click();
    await expect(row(page, ACEITES).getByTestId('category-tag')).toHaveText(t('tagMapped', { target: ACEITE }));
    await expect(row(page, ACEITES).getByTestId('category-result')).toContainText(
      t('productsMoved', { count: 1, countText: '1', target: ACEITE }),
    );
    expect(categoryOfProduct('e2e-cat-cuatro')).toBe(ACEITE);
  });

  test('removing an assigned row asks first, then clears its products and returns it to not reviewed (AC 21, 22, 30)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);

    await row(page, ACEITES).getByTestId('category-remove').click();
    await expect(row(page, ACEITES).getByTestId('category-confirm')).toContainText(t('confirmRemoveTitle', { category: ACEITES }));
    await row(page, ACEITES).getByRole('button', { name: copy.confirmRemoveYes }).click();

    const back = row(page, ACEITES);
    await expect(back.getByTestId('category-tag')).toHaveText(copy.tagPending);
    await expect(back.getByTestId('category-result')).toContainText(t('productsCleared', { count: 1, countText: '1' }));
    expect(categoryOfProduct('e2e-cat-cuatro')).toBe('none');
    expect(recordCount()).toBe(0);
    expect(categorised()).toBe(0);
  });

  test('a failed save shows the error block under the row, keeps the row as it was and saves nothing (AC 45, 49)', async ({ page }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    await page.route('**/admin/categorias', async (route) => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
        return;
      }
      await route.continue();
    });

    await row(page, MINUSCULAS).getByRole('combobox').selectOption({ label: ACEITE });
    await row(page, MINUSCULAS).getByTestId('category-assign').click();

    const failed = row(page, MINUSCULAS);
    await expect(failed.getByTestId('admin-error')).toContainText(sources.errorTitle);
    await expect(failed.getByTestId('admin-error')).toContainText(form.failedBody);
    await expect(failed.getByTestId('category-tag')).toHaveText(copy.tagPending);
    await expect(page.getByRole('heading', { level: 1, name: copy.heading })).toBeVisible();
    expect(recordCount()).toBe(0);
    await page.unroute('**/admin/categorias');
  });
});

test.describe('the rest of the site is left as it was (AC 23, 50, 51)', () => {
  test('the demo feeds are listed with their mark and note, and nothing this spec did changed a demo mapping or product', async ({ page, request }) => {
    await signInAs(page, EMAIL, PASSWORD);
    await openScreen(page);
    const demoFeed = page.locator('[data-testid^="category-feed-"]').filter({ hasText: copy.demoNote }).first();
    await expect(demoFeed).toContainText(sources.demoMark);
    await expect(demoFeed.getByTestId('category-feed-domain')).toContainText(sources.domainNone);

    expect(demoFingerprint()).toBe(demoBefore);

    // A public page still sets no cookie, and opening the screen changed no public answer.
    const home = await request.get('/');
    expectNoSetCookie(home);
    const sitemap = await request.get('/sitemap.xml');
    expect(await sitemap.text()).not.toContain('e2e-cat-');
  });
});
