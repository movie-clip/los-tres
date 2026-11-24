import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_FEED_URLS, DEMO_SHARED, DEMO_SHOP_HOSTS } from '../fixtures/demo';
import { adminTest, signInAsAdmin } from '../support/admin-e2e';
import { E2E_ADMIN, origin, psql, psqlScalar, serviceLogs } from '../support/e2e-stack';
import { expectNoSetCookie, expectServerRenderedNotFound } from '../support/page-checks';

// US-2.4 from sign-in to a product and an offer hidden and unhidden through the screens, with what
// each does to the public page, `/go` and search, the list state kept, the keyboard, the failure
// line, and the app output holding no feed address and no search term (guardrail 5). Desktop width
// only: admin screens are not checked at phone width.
//
// The demo product is hidden for real, on the e2e stack's own `app` and database (#363). Hiding it
// would change the counts and pages that the other specs read in parallel, so the spec runs in the
// `serial` project, alone, and leaves the product and both offers not hidden when it ends (`afterAll`
// puts them back even after a failure). It signs in as the e2e admin the global setup created.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const EMAIL = E2E_ADMIN.email;
const PASSWORD = E2E_ADMIN.password;

const copy = messages.Admin.Products;
const detail = messages.Admin.Products.Detail;
const siteName = (process.env.SITE_NAME ?? '').trim();

const SLUG = DEMO_SHARED.slug;
const TITLE = DEMO_SHARED.title;
const TERM = DEMO_SHARED.ean; // an exact EAN finds this product alone, in the admin list and in the public search
const [CHEAPER, DEARER] = DEMO_SHARED.offers; // Tienda Demo Dos (11,49), Tienda Demo Uno (12,99)

/** The e2e `app`: what a context made with `browser.newContext` must be given as its base URL. */
const appOrigin = (): string => origin('app');

/** Leaves the demo product and its offers not hidden, whatever a failed test left. */
function restoreHidden(): void {
  psql(`update products set is_hidden = false where slug = '${SLUG}'`);
  psql(`update offers set is_hidden = false where product_id in (select id from products where slug = '${SLUG}')`);
}

test.beforeAll(restoreHidden);
test.afterAll(restoreHidden);

async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: appOrigin() });
  const page = await context.newPage();
  await signInAsAdmin(page);
  return page;
}

const productId = (): number => Number(psqlScalar(`select id from products where slug = '${SLUG}'`));
const productHidden = (): boolean => psqlScalar(`select is_hidden from products where slug = '${SLUG}'`) === 't';

const offerWhere = (shop: string): string =>
  `from offers o join products p on p.id = o.product_id join feeds f on f.id = o.feed_id join shops s on s.id = f.shop_id where p.slug = '${SLUG}' and s.name = '${shop}'`;
const offerId = (shop: string): number => Number(psqlScalar(`select o.id ${offerWhere(shop)}`));
const offerHidden = (shop: string): boolean => psqlScalar(`select o.is_hidden ${offerWhere(shop)}`) === 't';

/** What the public site answers for the product page, `/go` of each offer (cheaper first) and a search for the term. */
async function publicState(request: APIRequestContext) {
  const page = await request.get(`/producto/${SLUG}`, { maxRedirects: 0 });
  expectNoSetCookie(page);
  const go: number[] = [];
  for (const offer of [CHEAPER, DEARER]) {
    const response = await request.get(`/go/${offerId(offer.shopName)}`, { maxRedirects: 0 });
    expectNoSetCookie(response);
    go.push(response.status());
  }
  const search = await request.get(`/buscar?q=${TERM}`);
  expectNoSetCookie(search);
  return { page: page.status(), pageHtml: await page.text(), go, searchHtml: await search.text() };
}

const offerRow = (page: Page, shop: string) => page.getByTestId('offer-row').filter({ hasText: shop });

test.describe('hide and unhide from the admin screens (US-2.4)', () => {
  let publicRequest: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    publicRequest = await playwright.request.newContext({ baseURL: appOrigin() });
  });
  test.afterAll(async () => {
    await publicRequest?.dispose();
  });

  test('finds the product from the list by its EAN and shows it not hidden and on the site', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto('/admin/productos');
    await expect(page.getByRole('heading', { level: 1, name: copy.heading })).toBeVisible();

    await page.getByLabel(copy.searchLabel).fill(TERM);
    await page.getByTestId('products-search-submit').click();

    await expect(page).toHaveURL(new RegExp(`[?&]q=${TERM}(&|$)`));
    const rows = page.getByTestId('product-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.getByTestId('product-row-title')).toHaveText(TITLE);
    await expect(rows.getByTestId('product-row-tag')).toHaveText(copy.tagNotHidden);
    await expect(rows.getByTestId('product-row-public')).toContainText(copy.publicNowYes);
    await expect(page.getByLabel(copy.searchLabel)).toHaveValue(TERM);
  });

  test('the baseline is public: the page answers 200, both offers redirect and the search finds it (non-vacuity)', async () => {
    const state = await publicState(publicRequest);
    expect(state.page).toBe(200);
    expect(state.go).toEqual([302, 302]);
    expect(state.searchHtml).toContain(TITLE);
  });

  test('hides the product: it says so in words, and the public page, /go and search answer as if it did not exist', async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    await expect(page.getByTestId('product-tag')).toHaveText(copy.tagNotHidden);

    await page.getByTestId('product-toggle-button').click();

    await expect(page.getByTestId('product-done')).toHaveText(detail.doneProductHidden);
    await expect(page.getByTestId('product-tag')).toHaveText(copy.tagHidden);
    await expect(page.getByTestId('product-public')).toContainText(copy.publicNowNo);
    await expect(page.getByTestId('product-toggle-button')).toHaveText(detail.unhideProduct);
    expect(productHidden()).toBe(true);
    // The two offers are not changed by it (the flags are independent).
    expect(offerHidden(CHEAPER.shopName)).toBe(false);
    expect(offerHidden(DEARER.shopName)).toBe(false);

    const state = await publicState(publicRequest);
    expect(state.page).toBe(404);
    expectServerRenderedNotFound(state.pageHtml, siteName);
    expect(state.go).toEqual([404, 404]);
    expect(state.searchHtml).not.toContain(TITLE);
  });

  test('keeps the term, the hidden-only filter and the page on the product page and its back link, and after a press', async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos?q=${TERM}&ocultos=1`);
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await expect(page.getByTestId('product-row-tag')).toHaveText(copy.tagHidden);
    await expect(page.getByTestId('products-hidden-only')).toBeChecked();

    await page.getByTestId('product-row-title').click();
    await expect(page).toHaveURL(new RegExp(`/admin/productos/${productId()}\\?`));
    const arrived = page.url();
    expect(arrived).toContain(`q=${TERM}`);
    expect(arrived).toContain('ocultos=1');

    // Back link on an address that also carries a page: all three survive in it.
    await page.goto(`/admin/productos/${productId()}?q=${TERM}&ocultos=1&pagina=2`);
    const back = await page.getByTestId('product-back').getAttribute('href');
    expect(back).toContain(`q=${TERM}`);
    expect(back).toContain('ocultos=1');
    expect(back).toContain('pagina=2');

    // Unhide from this page: the press does not navigate, so the address is the same afterwards.
    await page.goto(arrived);
    await page.getByTestId('product-toggle-button').click();
    await expect(page.getByTestId('product-done')).toHaveText(detail.doneProductUnhidden);
    expect(page.url()).toBe(arrived);
    expect(productHidden()).toBe(false);

    // The list the back link leads to still has the term and the filter; the product is no longer in it.
    await page.getByTestId('product-back').click();
    await expect(page.getByLabel(copy.searchLabel)).toHaveValue(TERM);
    await expect(page.getByTestId('products-hidden-only')).toBeChecked();
    await expect(page.getByTestId('product-row')).toHaveCount(0);
    await expect(page.getByTestId('products-empty')).toBeVisible();
  });

  test('after the unhide the product is back on the public site with both offers, and the line never says it was published', async ({
    browser,
  }) => {
    const state = await publicState(publicRequest);
    expect(state.page).toBe(200);
    expect(state.go).toEqual([302, 302]);
    expect(state.searchHtml).toContain(TITLE);

    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    // The line of a press tells what was saved, not that the site now shows it (AC 59).
    await page.getByTestId('product-toggle-button').click();
    await expect(page.getByTestId('product-done')).toHaveText(detail.doneProductHidden);
    await page.getByTestId('product-toggle-button').click();
    await expect(page.getByTestId('product-done')).toHaveText(detail.doneProductUnhidden);
    await expect(page.getByTestId('product-done')).not.toContainText(/aparece|publica|visible en el sitio/i);
  });

  test('hides one offer from the keyboard: the other offer still redirects, the page lists one shop, and it unhides', async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    const first = offerRow(page, CHEAPER.shopName);
    await expect(first).toHaveCount(1);

    // Operable with the keyboard alone: focus the control, press Enter.
    const button = first.getByTestId('offer-toggle-button');
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(first.getByTestId('offer-done')).toHaveText(detail.doneOfferHidden);
    await expect(first.getByTestId('offer-tag')).toHaveText(copy.tagOfferHidden);
    await expect(button).toBeFocused();
    expect(offerHidden(CHEAPER.shopName)).toBe(true);
    expect(productHidden()).toBe(false);

    const state = await publicState(publicRequest);
    expect(state.page).toBe(200);
    expect(state.go).toEqual([404, 302]);
    expect(state.pageHtml).toContain(DEARER.shopName);
    expect(state.pageHtml).not.toContain(CHEAPER.shopName);

    await button.press('Space');
    await expect(first.getByTestId('offer-done')).toHaveText(detail.doneOfferUnhidden);
    expect(offerHidden(CHEAPER.shopName)).toBe(false);
    expect((await publicState(publicRequest)).go).toEqual([302, 302]);
  });

  test('a failed save shows the error block and changes nothing', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    await page.waitForLoadState('networkidle');
    await page.route('**/admin/productos/**', async (route) => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await route.fulfill({ status: 500, body: 'boom' });
      } else {
        await route.continue();
      }
    });

    await page.getByTestId('product-toggle-button').click();

    await expect(page.getByTestId('admin-error')).toContainText(detail.errorTitle);
    await expect(page.getByTestId('admin-error')).toContainText(detail.errorProductBody);
    await expect(page.getByTestId('product-done')).toHaveCount(0);
    expect(productHidden()).toBe(false);
  });

  test('the app output holds no feed address, no shop host, no search term and no credential after all of it (guardrail 5)', async ({
    browser,
  }) => {
    // One more search, hide and unhide, then read the output of the app.
    const page = await signedIn(browser);
    await page.goto(`/admin/productos?q=${TERM}`);
    await page.goto(`/admin/productos/${productId()}?q=${TERM}`);
    await page.getByTestId('product-toggle-button').click();
    await expect(page.getByTestId('product-done')).toHaveText(detail.doneProductHidden);
    await page.getByTestId('product-toggle-button').click();
    await expect(page.getByTestId('product-done')).toHaveText(detail.doneProductUnhidden);
    expect(productHidden()).toBe(false);

    const logs = serviceLogs('app');
    expect(logs, 'the app answered').toContain('Ready');
    for (const forbidden of [TERM, SLUG, ...DEMO_FEED_URLS, ...DEMO_SHOP_HOSTS, EMAIL, PASSWORD]) {
      expect(logs.includes(forbidden), `the app output holds ${forbidden === PASSWORD ? 'the password' : forbidden}`).toBe(false);
    }
  });

  test('leaves the product and both offers not hidden', async () => {
    expect(productHidden()).toBe(false);
    expect(offerHidden(CHEAPER.shopName)).toBe(false);
    expect(offerHidden(DEARER.shopName)).toBe(false);
  });
});

// The file is serial, so a hard failure would skip the checks after it: the three parts below are
// one test with soft assertions on the names, so a red run reports every one of them.
test.describe('a toggle keeps its accessible name while it is saving', () => {
  // The hide POST is held (never answered) so the button stays pending, then aborted at the end:
  // nothing is written, so the database is as it was found.
  async function holdPosts(page: Page) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/admin/productos/**', async (route) => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await gate;
        await route.abort();
      } else {
        await route.continue();
      }
    });
    return release;
  }

  const offerName = (shop: string): string =>
    detail.hideOfferName.replace('{shop}', shop).replace('{id}', psqlScalar(`select o.feed_id ${offerWhere(shop)}`));

  test('offer and product toggles held pending keep their accessible names, and the text says they are saving', async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    await page.waitForLoadState('networkidle');
    const cheaper = offerRow(page, CHEAPER.shopName).getByTestId('offer-toggle-button');
    const dearer = offerRow(page, DEARER.shopName).getByTestId('offer-toggle-button');
    const product = page.getByTestId('product-toggle-button');

    // Idle names, so the pending checks below compare against something real.
    await expect(cheaper).toHaveAccessibleName(offerName(CHEAPER.shopName));
    await expect(dearer).toHaveAccessibleName(offerName(DEARER.shopName));
    await expect(product).toHaveAccessibleName(detail.hideProduct);
    expect(offerName(CHEAPER.shopName)).not.toBe(offerName(DEARER.shopName));

    const release = await holdPosts(page);
    try {
      // Two offer toggles pending at once.
      await cheaper.click();
      await dearer.click();
      await expect(cheaper).toHaveText(detail.saving);
      await expect(dearer).toHaveText(detail.saving);
      await expect.soft(cheaper, 'offer toggle, pending: name').toHaveAccessibleName(offerName(CHEAPER.shopName));
      await expect.soft(dearer, 'second offer toggle, pending: name').toHaveAccessibleName(offerName(DEARER.shopName));
      const [one, two] = await Promise.all([cheaper.getAttribute('aria-label'), dearer.getAttribute('aria-label')]);
      expect.soft(one, 'two pending offer toggles have an aria-label').not.toBeNull();
      expect.soft(one, 'two pending offer toggles do not share a name').not.toBe(two);

      // The product toggle pending, on its own (its name is its idle visible label).
      await product.click();
      await expect(product).toHaveText(detail.saving);
      await expect.soft(product, 'product toggle, pending: name').toHaveAccessibleName(detail.hideProduct);
    } finally {
      release();
    }
    expect(productHidden()).toBe(false);
    expect(offerHidden(CHEAPER.shopName)).toBe(false);
    expect(offerHidden(DEARER.shopName)).toBe(false);
  });
});

// #339 (0006 rule 12): journey J11, an admin hides and unhides a product and the public page follows. Added beside
// the tests it replaces. It signs in once per worker (`adminTest`) and reads the public site through the `publicRequest`
// fixture, which holds no admin session. The file's `beforeAll` and `afterAll` leave the product not hidden even if
// this test fails half way.
adminTest.describe('hide and unhide journey (#339)', () => {
  adminTest('J11: find the product by its EAN, hide it and the public site drops it, unhide it and the site shows it again', async ({
    page,
    publicRequest: request,
  }) => {
    /** The public answers for the product page, its two offers' /go links and a search for the EAN. */
    async function publicAnswers(goPaths: string[]) {
      const product = await request.get(`/producto/${SLUG}`, { maxRedirects: 0 });
      const go: number[] = [];
      for (const path of goPaths) go.push((await request.get(path, { maxRedirects: 0 })).status());
      const search = await request.get(`/buscar?q=${TERM}`);
      return { status: product.status(), html: await product.text(), go, search: await search.text() };
    }

    // The baseline: public, with a /go link per offer (the ids are read from the page, they differ between runs).
    const before = await request.get(`/producto/${SLUG}`);
    expect(before.status()).toBe(200);
    const goPaths = [...(await before.text()).matchAll(/href="(\/go\/\d+)"/g)].map((match) => match[1]);
    expect(goPaths).toHaveLength(DEMO_SHARED.offers.length);
    const baseline = await publicAnswers(goPaths);
    expect(baseline.status).toBe(200);
    expect(baseline.go).toEqual([302, 302]);
    expect(baseline.search).toContain(TITLE);

    // Find it from the list by its EAN: one row, not hidden, on the site now.
    await page.goto('/admin/productos');
    await page.getByRole('textbox', { name: copy.searchLabel, exact: true }).fill(TERM);
    await page.getByRole('button', { name: copy.searchButton, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]q=${TERM}(&|$)`));
    const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: TITLE, exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByText(copy.tagNotHidden, { exact: true })).toBeVisible();
    await row.getByRole('link', { name: TITLE, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Hide it: the screen says so in words, and the public page, /go and search answer as if it did not exist.
    await page.getByRole('button', { name: detail.hideProduct, exact: true }).click();
    await expect(page.getByText(detail.doneProductHidden, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: detail.unhideProduct, exact: true })).toBeVisible();
    const hidden = await publicAnswers(goPaths);
    expect(hidden.status).toBe(404);
    expectServerRenderedNotFound(hidden.html, siteName);
    expect(hidden.go).toEqual([404, 404]);
    expect(hidden.search).not.toContain(TITLE);

    // Unhide it: the site shows it again with both offers, and the screen never says it was published.
    await page.getByRole('button', { name: detail.unhideProduct, exact: true }).click();
    await expect(page.getByText(detail.doneProductUnhidden, { exact: true })).toBeVisible();
    await expect(page.getByText(detail.doneProductUnhidden, { exact: true })).not.toContainText(/aparece|publica|visible en el sitio/i);
    const shown = await publicAnswers(goPaths);
    expect(shown.status).toBe(200);
    expect(shown.go).toEqual([302, 302]);
    expect(shown.search).toContain(TITLE);
  });
});
