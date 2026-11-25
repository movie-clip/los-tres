import { expect, test, type Page } from '@playwright/test';

import { DEMO_CATEGORY_COUNTS, DEMO_LONG_TITLE } from '../fixtures/demo';
import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import { LONGEST_CAR } from '../support/car';

// S11.7 (0006 rule 11, #339): the public pages do not scroll sideways at 390 px. The legal pages other than the
// funding page are left out: they answer 500 while the owner identity in .env is blank.

const ROOT = FIXED_CATEGORY_TREE.slug;

/** The href of the long-title demo product, found on the root listing pages. */
async function longTitleUrl(page: Page): Promise<string> {
  const pages = Math.ceil(DEMO_CATEGORY_COUNTS[ROOT as keyof typeof DEMO_CATEGORY_COUNTS] / 24);
  for (let index = 1; index <= pages; index += 1) {
    await page.goto(index === 1 ? `/categoria/${ROOT}` : `/categoria/${ROOT}?pagina=${index}`);
    const link = page.getByTestId('card-title').filter({ hasText: DEMO_LONG_TITLE.title.slice(0, 40) });
    if ((await link.count()) > 0) return (await link.first().getAttribute('href'))!;
  }
  throw new Error('the long-title demo product was not on any root page');
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// #339 (0006 rule 11): the one reflow check per public page family: at 390 px the page does not scroll
// sideways. It asserts nothing else about size or position. Each page is opened with the longest car selected,
// because the header's car row is the widest thing a visitor sees; the picker page draws no car control of its
// own, so it is opened as it is.
test.describe('no sideways scroll at 390 px (#339)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const withLongestCar = (url: string): string => `${url}${url.includes('?') ? '&' : '?'}coche=${LONGEST_CAR.slug}`;

  const FAMILIES: { name: string; url: string }[] = [
    { name: 'home', url: withLongestCar('/') },
    { name: 'category', url: withLongestCar('/categoria/filtros-de-aire') },
    { name: 'search, a 100-character term', url: withLongestCar(`/buscar?q=${'w'.repeat(100)}`) },
    { name: 'car picker', url: '/mi-coche' },
    { name: 'legal', url: withLongestCar('/como-nos-financiamos') },
    { name: '404', url: withLongestCar('/producto/no-existe') },
  ];

  for (const { name, url } of FAMILIES) {
    test(`${name}: the page does not scroll sideways`, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  test('product, the long-title demo product: the page does not scroll sideways', async ({ page }) => {
    await page.goto(withLongestCar(await longTitleUrl(page)));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});
