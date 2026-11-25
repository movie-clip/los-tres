import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import { DEMO_CATEGORY_NAMES, DEMO_SHARED } from '../fixtures/demo';
import { icuPlural } from '../support/messages';
import { aria, expectSmoke, PRODUCTS } from '../support/smoke';

const ROOT = FIXED_CATEGORY_TREE.slug;

// #339 (0006 rules 11 and 12): the smoke test of the home page family and journey J2. The tile
// counts are patterns; the names are the fixed category tree's.
test.describe('home smoke and journey (#339)', () => {
  test('S1 smoke: the home page answers 200, its main region matches and the console is clean', async ({ page }) => {
    await expectSmoke(
      page,
      '/',
      aria`
        - heading "${messages.Home.heading}" [level=1]
        - paragraph: ${messages.Home.tagline}
        - search:
          - searchbox "${messages.Home.searchLabel}"
          - button "${messages.Home.searchButton}"
        - heading "${messages.Home.categoriesHeading}" [level=2]
        - link /${messages.Home.allLink} ${PRODUCTS}/:
          - /url: /categoria/${ROOT}
        - list:
          - listitem:
            - link /${DEMO_CATEGORY_NAMES['aceite-de-motor']} ${PRODUCTS}/:
              - /url: /categoria/aceite-de-motor
          - listitem:
            - link /${DEMO_CATEGORY_NAMES['filtros-de-aceite']} ${PRODUCTS}/:
              - /url: /categoria/filtros-de-aceite
      `,
    );
  });

  test('J2: from the home page to a category to a product through the category tree', async ({ page }) => {
    const leaf = 'filtros-de-aceite';
    await page.goto('/');
    const tile = page.getByRole('link', { name: new RegExp(`^${DEMO_CATEGORY_NAMES[leaf]} \\d+ productos?$`) });
    const shown = Number(/(\d+)/.exec(await tile.innerText())?.[1]);
    expect(shown).toBeGreaterThan(0);

    await tile.click();
    await expect(page).toHaveURL(new RegExp(`/categoria/${leaf}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_CATEGORY_NAMES[leaf]);
    // The home count and the category page count are the same number (invariant I-1).
    await expect(page.getByText(icuPlural(messages.Category.summary, shown), { exact: true })).toBeVisible();

    await page.getByRole('link', { name: DEMO_SHARED.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/producto/${DEMO_SHARED.slug}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_SHARED.title);

    // The crumbs run from the root down, and the parent crumb leads back into the tree.
    const crumbs = page.getByRole('navigation', { name: messages.Product.breadcrumbLabel }).getByRole('link');
    await expect(crumbs).toHaveText([DEMO_CATEGORY_NAMES[ROOT], DEMO_CATEGORY_NAMES[leaf]]);
    await crumbs.nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/categoria/${leaf}$`));
  });
});
