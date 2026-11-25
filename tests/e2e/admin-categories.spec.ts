import { expect, test, type Locator, type Page } from '@playwright/test';
import { createTranslator } from 'use-intl/core';

import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import messages from '../../messages/es-ES.json';
import { signInAsAdmin } from '../support/admin-e2e';
import { psql, psqlScalar } from '../support/e2e-stack';

// US-4.2 against the e2e stack, at desktop width only (admin screens are not checked at phone
// width): J10 of 0006 rule 12, an admin maps a feed category (the screen, the refusals and the confirm
// panels are integration tests, category-mapping-page.test.ts and category-mapping-actions.test.ts).
//
// The spec works on a feed of its own (one shop, two feeds, five products) and never touches the
// demo mappings or demo products, which other specs depend on (D-5). Its rows are a FIXED set, found
// again on every run and put back to their starting state (no record, no category, nothing approved),
// so repeated runs add no row. The feed stays NOT approved for the whole spec, on purpose: that makes the
// public side of guardrail 1 the thing this spec shows end to end (a mapping on an unapproved feed
// publishes nothing). That a removal takes an approved feed's product off every public reader at once is
// proved in integration, with the real readers (category-mapping-writer.test.ts, AC 31). It signs in as the
// e2e admin the global setup created.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const copy = messages.Admin.Categories;
const t = createTranslator({ locale: 'es-ES', messages, namespace: 'Admin.Categories' });

const SHOP = { slug: 'e2e-cat-tienda', name: 'Tienda e2e categorias' };
const KEY = 'KEY-E2E-CATEGORIAS';
const HOST = 'e2e-categorias.example';
const URL_MAIN = `https://${HOST}:8443/privado/${KEY}/catalogo.csv?apikey=${KEY}#frag-${KEY}`;
const URL_EMPTY = 'https://e2e-categorias-vacia.example/catalogo.csv';

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
const [, FILTRO_ACEITE] = TARGETS;

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

let mainId = 0;

test.beforeAll(() => {
  releaseRows();
  resetRows();
  mainId = feedIdOf(URL_MAIN);
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

test.describe('saving (AC 18 to 22, 24, 26 to 33, 40, 49)', () => {
  test('assigning moves the row to Revisadas, says what was done and how many products followed, and moves them with no import', async ({ page }) => {
    await signInAsAdmin(page);
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
});
