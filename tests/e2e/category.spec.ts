import { expect, test, type Locator, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import {
  DEMO_CATEGORY_COUNTS,
  DEMO_CATEGORY_NAMES,
  DEMO_DRILL,
  DEMO_FILLER,
  DEMO_LONG_TITLE,
  DEMO_NO_BRAND,
  DEMO_SHARED,
  DEMO_UNMAPPED_CATEGORY,
  DEMO_UNMAPPED_EMPTY,
} from '../fixtures/demo';
import { loadEnv } from '../support/env';
import { icuPlural, normaliseSpaces } from '../support/messages';
import {
  expectLocalScriptsAndLinks,
  expectNoForeignOrigin,
  expectNoSetCookie,
  openRawHtml,
} from '../support/page-checks';

// S5.1 category page against the Compose stack, with the demo data. Elements
// are selected only by the data-testid values of C-5 (03-design § Contract);
// the one other query is the level-1 heading by role, for the category name.

loadEnv();
const siteName = (process.env.SITE_NAME ?? '').trim();

const category = (slug: string, page?: number | string) =>
  `/categoria/${slug}${page === undefined ? '' : `?pagina=${page}`}`;
const FILTROS = 'filtros';
const PAGE_SIZE = 24;
const filtrosCount = DEMO_CATEGORY_COUNTS.filtros;
const filtrosPages = Math.ceil(filtrosCount / PAGE_SIZE);

const price = async (locator: Locator) => normaliseSpaces((await locator.textContent())?.trim() ?? '');
const cardWithTitle = (page: Page, title: string) =>
  page.getByTestId('category-card').filter({ has: page.getByTestId('card-title').filter({ hasText: title }) });
const summaryText = (count: number, pageNumber?: number, pages?: number) =>
  pageNumber === undefined
    ? icuPlural(messages.Category.summary, count)
    : `${icuPlural(messages.Category.summary, count)} · ${messages.Category.pageIndicator
        .replace('{page}', String(pageNumber))
        .replace('{pages}', String(pages))}`;

test.describe('category page /categoria/<slug> (S5.1)', () => {
  test('server-renders the first page with JavaScript off and sets no cookie', async ({ request, browser }) => {
    const response = await request.get(category(FILTROS));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expectNoSetCookie(response);

    const { page, close } = await openRawHtml(browser, await response.text());
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_CATEGORY_NAMES.filtros);
    expect(await page.title()).toBe(
      messages.Category.metaTitle.replace('{category}', DEMO_CATEGORY_NAMES.filtros).replace('{siteName}', siteName),
    );
    await expect(page.getByTestId('category-card')).toHaveCount(PAGE_SIZE);
    await expect(page.getByTestId('pagination')).toHaveCount(1);
    await expect(page.getByTestId('category-empty')).toHaveCount(0);
    await expectLocalScriptsAndLinks(page);
    await close();
  });

  test('summarises the count and the page, and states that prices include IVA', async ({ page }) => {
    await page.goto(category(FILTROS));
    await expect(page.getByTestId('category-summary')).toHaveText(summaryText(filtrosCount, 1, filtrosPages));
    await expect(page.getByText(messages.Product.vatIncluded, { exact: true })).toHaveCount(1);
  });

  test('lists cards cheapest first with price in EUR, and no "from" label for a single shop', async ({ page }) => {
    await page.goto(category(FILTROS));
    const first = page.getByTestId('category-card').first();
    await expect(first.getByTestId('card-title')).toHaveText(DEMO_FILLER.firstTitle);
    expect(await price(first.getByTestId('card-price'))).toBe('5,55 €');
    await expect(first.getByTestId('card-price-from')).toHaveCount(0);
    await expect(first.getByTestId('card-shop-count')).toHaveText(icuPlural(messages.Product.shopCount, 1));

    const prices = (await page.getByTestId('card-price').allTextContents()).map((text) =>
      Number(normaliseSpaces(text).replace(/[^\d,]/g, '').replace(',', '.')),
    );
    expect(prices).toHaveLength(PAGE_SIZE);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  test('shows the shared filter with "Desde", the lowest of two shops, and the plural count', async ({ page }) => {
    await page.goto(category(FILTROS));
    const card = cardWithTitle(page, DEMO_SHARED.title);
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('card-price-from')).toHaveText(messages.Category.priceFrom);
    expect(await price(card.getByTestId('card-price'))).toBe('11,49 €');
    await expect(card.getByTestId('card-shop-count')).toHaveText(icuPlural(messages.Product.shopCount, 2));
    await expect(card.getByTestId('card-brand')).toHaveText(DEMO_SHARED.brand);
    // The card carries no shipping and no /go link.
    expect(await card.innerHTML()).not.toMatch(/\/go\/|env[ií]o/i);
  });

  test('opens a product from its card and lands on that product page', async ({ page }) => {
    await page.goto(category(FILTROS));
    const card = cardWithTitle(page, DEMO_SHARED.title);
    await card.getByTestId('card-title').click();
    await expect(page).toHaveURL(new RegExp(`/producto/${DEMO_SHARED.slug}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_SHARED.title);
  });

  test('page 2 holds the rest, with previous and no next, and previous goes back to the clean URL', async ({
    page,
  }) => {
    await page.goto(category(FILTROS));
    await expect(page.getByTestId('pagination-prev')).toHaveCount(0);
    await expect(page.getByTestId('pagination-indicator')).toHaveText(
      messages.Category.pageIndicator.replace('{page}', '1').replace('{pages}', String(filtrosPages)),
    );
    await expect(page.getByTestId('pagination-next')).toContainText(messages.Category.nextPage);
    await expect(page.getByTestId('pagination-next')).toHaveAttribute('href', category(FILTROS, 2));

    await page.getByTestId('pagination-next').click();

    await expect(page).toHaveURL(new RegExp(`${category(FILTROS, 2).replace('?', '\\?')}$`));
    await expect(page.getByTestId('category-card')).toHaveCount(filtrosCount - PAGE_SIZE);
    await expect(page.getByTestId('category-summary')).toHaveText(summaryText(filtrosCount, 2, filtrosPages));
    await expect(page.getByTestId('pagination-indicator')).toHaveText(
      messages.Category.pageIndicator.replace('{page}', '2').replace('{pages}', String(filtrosPages)),
    );
    await expect(page.getByTestId('pagination-next')).toHaveCount(0);
    await expect(page.getByTestId('pagination-prev')).toContainText(messages.Category.previousPage);
    await expect(page.getByTestId('pagination-prev')).toHaveAttribute('href', category(FILTROS));
    expect(await page.title()).toBe(
      messages.Category.metaTitlePaged
        .replace('{category}', DEMO_CATEGORY_NAMES.filtros)
        .replace('{page}', '2')
        .replace('{siteName}', siteName),
    );

    await page.getByTestId('pagination-prev').click();
    await expect(page).toHaveURL(new RegExp(`${category(FILTROS)}$`));
    await expect(page.getByTestId('category-card')).toHaveCount(PAGE_SIZE);
  });

  test('page 2 continues the order of page 1 without repeating a product', async ({ request, browser }) => {
    const titles: string[] = [];
    for (const target of [category(FILTROS), category(FILTROS, 2)]) {
      const { page, close } = await openRawHtml(browser, await (await request.get(target)).text());
      titles.push(...(await page.getByTestId('card-title').allTextContents()));
      await close();
    }
    expect(titles).toHaveLength(filtrosCount);
    expect(new Set(titles).size).toBe(filtrosCount);
  });

  test('shows a product of a child category in its parent, and the roots hold nothing of their own', async ({
    page,
  }) => {
    await page.goto(category('automovil'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_CATEGORY_NAMES.automovil);
    await expect(page.getByTestId('category-summary')).toContainText(
      icuPlural(messages.Category.summary, DEMO_CATEGORY_COUNTS.automovil),
    );
    // The lamp lives in a child (escobillas-y-bombillas); it is the dearest-or-not among 27, so read both pages.
    const titles = await page.getByTestId('card-title').allTextContents();
    await page.goto(category('automovil', 2));
    titles.push(...(await page.getByTestId('card-title').allTextContents()));
    expect(titles).toContain(DEMO_NO_BRAND.title);
    expect(titles).toContain(DEMO_SHARED.title);
    expect(titles).toHaveLength(DEMO_CATEGORY_COUNTS.automovil);
  });

  test('shows the two tool products under the tools root and no pagination for one page', async ({ page }) => {
    await page.goto(category('herramientas'));
    await expect(page.getByTestId('category-card')).toHaveCount(DEMO_CATEGORY_COUNTS.herramientas);
    await expect(page.getByTestId('category-summary')).toHaveText(
      summaryText(DEMO_CATEGORY_COUNTS.herramientas),
    );
    await expect(page.getByTestId('pagination')).toHaveCount(0);
    await expect(page.getByTestId('card-title').filter({ hasText: DEMO_DRILL.title })).toHaveCount(1);
  });

  test('renders a product without a brand with no brand line', async ({ page }) => {
    await page.goto(category(DEMO_NO_BRAND.categorySlug));
    const card = cardWithTitle(page, DEMO_NO_BRAND.title);
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('card-brand')).toHaveCount(0);
    expect(await price(card.getByTestId('card-price'))).toBe('6,50 €');
    expect(await card.innerText()).not.toMatch(/null|undefined/);
  });

  test('never lists the unmapped demo products on any category page, and their pages are 404', async ({
    page,
    request,
  }) => {
    const unmapped = [DEMO_UNMAPPED_CATEGORY, DEMO_UNMAPPED_EMPTY];
    for (const slug of Object.keys(DEMO_CATEGORY_COUNTS)) {
      for (const pageNumber of [1, 2]) {
        const response = await page.goto(category(slug, pageNumber));
        if (response?.status() !== 200) continue; // page 2 of a one-page category is a 404
        const titles = await page.getByTestId('card-title').allTextContents();
        for (const product of unmapped) expect(titles).not.toContain(product.title);
      }
    }
    for (const product of unmapped) {
      const response = await request.get(`/producto/${product.slug}`);
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain(product.title);
    }
  });

  test('shows the empty state for a category with no public products, with status 200', async ({
    page,
    context,
  }) => {
    const response = await page.goto(category('aceites-y-lubricantes'));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_CATEGORY_NAMES['aceites-y-lubricantes']);
    await expect(page.getByTestId('category-empty')).toBeVisible();
    await expect(page.getByTestId('category-empty')).toContainText(messages.Category.emptyHeading);
    await expect(page.getByTestId('category-empty')).toContainText(messages.Category.emptyBody);
    await expect(page.getByTestId('category-card')).toHaveCount(0);
    await expect(page.getByTestId('category-summary')).toHaveCount(0);
    await expect(page.getByTestId('pagination')).toHaveCount(0);
    expect(await context.cookies()).toEqual([]);
  });

  test('answers 404 for page 2 of an empty category: it has exactly one page', async ({ request }) => {
    const response = await request.get(category('aceites-y-lubricantes', 2));
    expect(response.status()).toBe(404);
    expectNoSetCookie(response);
  });

  test('answers 404 with the Spanish not-found page for an unknown or malformed slug', async ({ page, context }) => {
    const response = await page.goto(category('no-existe-esta-categoria'));
    expect(response?.status()).toBe(404);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { name: messages.NotFound.heading })).toBeVisible();
    expect(await context.cookies()).toEqual([]);
  });

  for (const slug of ['Bad_Slug', 'UPPER', 'a--b', 'x'.repeat(130)]) {
    test(`a malformed slug (${slug.slice(0, 12)}) answers the same 404`, async ({ request }) => {
      const response = await request.get(category(slug));
      expect(response.status()).toBe(404);
      expectNoSetCookie(response);
      expect(await response.text()).toContain(messages.NotFound.heading);
    });
  }

  test('answers 404 past the last page, and for an absurdly large page, without a server error', async ({
    request,
  }) => {
    for (const pageNumber of [filtrosPages + 1, 99, '9'.repeat(400)]) {
      const response = await request.get(category(FILTROS, pageNumber));
      expect(response.status(), String(pageNumber).slice(0, 12)).toBe(404);
      expectNoSetCookie(response);
    }
  });

  for (const value of ['abc', '0', '-1', '1.5', '', '1']) {
    test(`reads ?pagina=${JSON.stringify(value)} as page 1 at the same URL, without a redirect`, async ({
      request,
    }) => {
      const response = await request.get(`${category(FILTROS)}?pagina=${encodeURIComponent(value)}`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain(
        messages.Category.pageIndicator.replace('{page}', '1').replace('{pages}', String(filtrosPages)),
      );
    });
  }

  test('a real browser visit sets no cookie, contacts no other origin and requests no /go URL', async ({
    page,
    context,
    baseURL,
  }) => {
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    await page.goto(category(FILTROS));
    await expect(page.getByTestId('category-card').first()).toBeVisible();
    await page.getByTestId('pagination-next').click();
    await expect(page.getByTestId('pagination-prev')).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(await context.cookies()).toEqual([]);
    expectNoForeignOrigin(requested, new URL(baseURL as string).origin);
    expect(requested.filter((url) => new URL(url).pathname.startsWith('/go/'))).toEqual([]);
  });
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test.describe(`layout at ${viewport.name} width (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('does not scroll sideways, with a 100-character title and a full grid', async ({ page }) => {
      await page.goto(category(FILTROS));
      await page.getByTestId('category-card').first().waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // The long-title card stays inside the viewport; the title is clamped, not stretched.
      const all = [category(FILTROS), category(FILTROS, 2)];
      let found = false;
      for (const target of all) {
        await page.goto(target);
        const card = cardWithTitle(page, DEMO_LONG_TITLE.title.slice(0, 40));
        if ((await card.count()) === 0) continue;
        found = true;
        const box = await card.first().boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.height).toBeLessThan(viewport.height);
      }
      expect(found).toBe(true);
    });

    test('keeps the pagination links inside the viewport and at least 44px tall', async ({ page }) => {
      await page.goto(category(FILTROS));
      const next = page.getByTestId('pagination-next');
      const nextBox = await next.boundingBox();
      expect(nextBox!.height).toBeGreaterThanOrEqual(44);
      expect(nextBox!.x + nextBox!.width).toBeLessThanOrEqual(viewport.width);

      await next.click();
      const prevBox = await page.getByTestId('pagination-prev').boundingBox();
      expect(prevBox!.height).toBeGreaterThanOrEqual(44);
      expect(prevBox!.x).toBeGreaterThanOrEqual(0);
      const indicator = await page.getByTestId('pagination-indicator').boundingBox();
      expect(indicator!.x).toBeGreaterThanOrEqual(0);
      expect(indicator!.x + indicator!.width).toBeLessThanOrEqual(viewport.width);
    });

    test('keeps the empty state readable with no sideways scroll', async ({ page }) => {
      await page.goto(category('aceites-y-lubricantes'));
      await expect(page.getByTestId('category-empty')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
