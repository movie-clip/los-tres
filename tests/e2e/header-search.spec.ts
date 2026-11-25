import { expect, test, type Page } from '@playwright/test';

import { DEMO_SHARED } from '../fixtures/demo';

// S5.4 T5.4.5 (US-5.4, AC 38, D-2, D-8) against the Compose stack, J3 of 0006 rule 12: a search from the header
// box of a public page lands on /buscar. Which pages show or hide the box is unit/site-header.test.ts.

const TERM = 'filtro';
const header = (page: Page) => page.getByTestId('header-search');

test.describe('header search box (S5.4 T5.4.5)', () => {
  test('AC 38: submitting from a product page by the button, and from a text page with Enter, lands on /buscar?q=<term> with the header box hidden', async ({
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

    // Enter in the field submits the same search.
    await page.goto('/como-nos-financiamos');
    await page.getByTestId('header-search-input').fill(TERM);
    await page.getByTestId('header-search-input').press('Enter');
    await page.waitForURL((url) => url.pathname === '/buscar');
    expect(new URL(page.url()).search).toBe(`?q=${TERM}`);
  });
});
