import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED } from '../fixtures/demo';

// S5.4 T5.4.5 (US-5.4, ACs 38 to 41, D-2, D-8) against the Compose stack: the header search box
// is on every public page except where the page owns a search form (/ and /buscar). Hidden means
// display:none from a stylesheet rule, so the pages are loaded with page.goto, not as raw HTML.
// The no-public-categories home case (box stays) is a unit render: home-no-categories.test.ts.
// The 195 and 360 px reflow of the header is in reflow.spec.ts.

const TERM = 'filtro';
const header = (page: Page) => page.getByTestId('header-search');

const SHOWN: [string, string][] = [
  ['product', `/producto/${DEMO_SHARED.slug}`],
  ['category', '/categoria/mantenimiento-del-coche'],
  ['empty category', '/categoria/filtros-de-combustible'],
  ['aviso legal', '/aviso-legal'],
  ['privacidad', '/privacidad'],
  ['como nos financiamos', '/como-nos-financiamos'],
  ['not found', '/esta-pagina-no-existe'],
];
// The page's own form: home-search on /, search-form on /buscar.
const HIDDEN: [string, string, string][] = [
  ['home', '/', 'home-search'],
  ['search page', '/buscar', 'search-form'],
  ['search results', `/buscar?q=${TERM}`, 'search-form'],
];

test.describe('header search box (S5.4 T5.4.5)', () => {
  for (const [name, route] of SHOWN) {
    test(`AC 38: ${name} shows the box with a field and a button, GET to /buscar`, async ({ page }) => {
      const response = await page.goto(route);
      expect((await response!.allHeaders())['set-cookie']).toBeUndefined();
      const form = header(page);
      await expect(form).toBeVisible();
      await expect(form).toHaveAttribute('method', /get/i);
      await expect(form).toHaveAttribute('action', '/buscar');
      await expect(page.getByTestId('header-search-input')).toBeVisible();
      await expect(page.getByTestId('header-search-input')).toHaveAttribute('name', 'q');
      await expect(page.getByTestId('header-search-button')).toBeVisible();
      await expect(page.getByTestId('header-search-button')).toHaveText(messages.Search.button);
      // AC 39: the site-name link stays beside it.
      await expect(page.getByTestId('site-header-link')).toBeVisible();
      await expect(page.getByTestId('header-search')).toHaveCount(1);
    });
  }

  for (const [name, route, own] of HIDDEN) {
    test(`AC 38, D-8: ${name} shows one search place, the header box is not visible`, async ({ page }) => {
      await page.goto(route);
      await expect(header(page)).toBeHidden();
      await expect(page.getByTestId('site-header-link')).toBeVisible();
      await expect(page.getByTestId(own)).toBeVisible();
      await expect(page.locator('form[action="/buscar"]:visible')).toHaveCount(1);
    });
  }

  test('AC 38: submitting from a product page lands on /buscar?q=<term> with the header box hidden', async ({
    page,
  }) => {
    await page.goto(`/producto/${DEMO_SHARED.slug}`);
    await page.getByTestId('header-search-input').fill(TERM);
    await page.getByTestId('header-search-button').click();
    await page.waitForURL((url) => url.pathname === '/buscar');
    expect(new URL(page.url()).search).toBe(`?q=${TERM}`);
    await expect(header(page)).toBeHidden();
    await expect(page.getByTestId('search-input')).toHaveValue(TERM);
    await expect(page.getByTestId('category-card').first()).toBeVisible();
  });

  test('AC 38: Enter in the field submits the same search', async ({ page }) => {
    await page.goto('/como-nos-financiamos');
    await page.getByTestId('header-search-input').fill(TERM);
    await page.getByTestId('header-search-input').press('Enter');
    await page.waitForURL((url) => url.pathname === '/buscar');
    expect(new URL(page.url()).search).toBe(`?q=${TERM}`);
  });

  test('AC 39, 61: Tab order is the site-name link, then the box field, then its button, then the car control', async ({ page }) => {
    await page.goto(`/producto/${DEMO_SHARED.slug}`);
    await expect(page.getByTestId('header-search-button')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('site-header-link')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('header-search-input')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('header-search-button')).toBeFocused();
    // S5.7 (AC 61): the car control is row 2 of the header, so it follows the search button.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('car-select')).toBeFocused();
  });

  test('AC 38: works with JavaScript disabled', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto(`/producto/${DEMO_SHARED.slug}`);
    await expect(header(page)).toBeVisible();
    await page.getByTestId('header-search-input').fill(TERM);
    await page.getByTestId('header-search-button').click();
    await page.waitForURL((url) => url.pathname === '/buscar');
    expect(new URL(page.url()).search).toBe(`?q=${TERM}`);
    await expect(header(page)).toBeHidden();
    await expect(page.getByTestId('category-card').first()).toBeVisible();
    expect(await context.cookies()).toEqual([]);
    await context.close();
  });

  test('AC 41: the admin sign-in page does not get the box', async ({ page }) => {
    await page.goto('/admin/acceso');
    await expect(page.getByTestId('header-search')).toHaveCount(0);
    await expect(page.locator('form[action="/buscar"]')).toHaveCount(0);
  });
});
