import { expect, test, type Locator, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import {
  DEMO_CATEGORY_COUNTS,
  DEMO_CATEGORY_NAMES,
  DEMO_DRILL,
  DEMO_CHEAPEST,
  DEMO_FOUR_OFFERS,
  DEMO_ILLUSTRATED,
  DEMO_LONG_TITLE,
  DEMO_NO_BRAND,
  DEMO_SHARED,
  DEMO_UNMAPPED_CATEGORY,
  DEMO_UNMAPPED_EMPTY,
  DEMO_WRENCHES,
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
// The root holds every product of its five children, so more than one page. A leaf
// holds one page at most (the largest, aceite-de-motor, is well under a full page).
const ROOT = 'mantenimiento-del-coche';
const OIL_FILTERS = 'filtros-de-aceite';
const EMPTY_LEAF = 'filtros-de-combustible';
const PAGE_SIZE = 24;
const rootCount = DEMO_CATEGORY_COUNTS[ROOT];
const rootPages = Math.ceil(rootCount / PAGE_SIZE);
/** Every page URL of the root listing, page one at the clean URL. */
const rootPageUrls = Array.from({ length: rootPages }, (_, index) =>
  index === 0 ? category(ROOT) : category(ROOT, index + 1),
);

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
    const response = await request.get(category(ROOT));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expectNoSetCookie(response);

    const { page, close } = await openRawHtml(browser, await response.text());
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_CATEGORY_NAMES[ROOT]);
    expect(await page.title()).toBe(
      messages.Category.metaTitle.replace('{category}', DEMO_CATEGORY_NAMES[ROOT]).replace('{siteName}', siteName),
    );
    await expect(page.getByTestId('category-card')).toHaveCount(PAGE_SIZE);
    await expect(page.getByTestId('pagination')).toHaveCount(1);
    await expect(page.getByTestId('category-empty')).toHaveCount(0);
    await expectLocalScriptsAndLinks(page);
    await close();
  });

  test('summarises the count and the page, and states that prices include IVA', async ({ page }) => {
    await page.goto(category(ROOT));
    await expect(page.getByTestId('category-summary')).toHaveText(summaryText(rootCount, 1, rootPages));
    await expect(page.getByText(messages.Product.vatIncluded, { exact: true })).toHaveCount(1);
  });

  test('lists cards cheapest first with price in EUR, and no "from" label for a single shop', async ({ page }) => {
    await page.goto(category(ROOT));
    const first = page.getByTestId('category-card').first();
    await expect(first.getByTestId('card-title')).toHaveText(DEMO_CHEAPEST.title);
    expect(await price(first.getByTestId('card-price'))).toBe('3,90 €');
    await expect(first.getByTestId('card-price-from')).toHaveCount(0);
    await expect(first.getByTestId('card-shop-count')).toHaveText(
      icuPlural(messages.Product.shopCount, DEMO_CHEAPEST.offerCount),
    );

    const prices = (await page.getByTestId('card-price').allTextContents()).map((text) =>
      Number(normaliseSpaces(text).replace(/[^\d,]/g, '').replace(',', '.')),
    );
    expect(prices).toHaveLength(PAGE_SIZE);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  test('shows the shared filter with "Desde", the lowest of two shops, and the plural count', async ({ page }) => {
    await page.goto(category(OIL_FILTERS));
    const card = cardWithTitle(page, DEMO_SHARED.title);
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('card-price-from')).toHaveText(messages.Category.priceFrom);
    expect(await price(card.getByTestId('card-price'))).toBe('11,49 €');
    await expect(card.getByTestId('card-shop-count')).toHaveText(icuPlural(messages.Product.shopCount, 2));
    await expect(card.getByTestId('card-brand')).toHaveText(DEMO_SHARED.brand);
    // The card carries no shipping and no /go link.
    expect(await card.innerHTML()).not.toMatch(/\/go\/|env[ií]o/i);
  });

  test('shows a decorative tile with the category drawing on the card of each populated leaf', async ({ page }) => {
    await page.goto(category(ROOT));
    // Every card has the tile, hidden from assistive technology, and the root page mixes leaves.
    const tiles = page.getByTestId('card-tile');
    await expect(tiles).toHaveCount(PAGE_SIZE);
    await expect(page.locator('[data-testid="card-tile"]:not([aria-hidden="true"])')).toHaveCount(0);
    for (const [leaf, productSlug] of Object.entries(DEMO_ILLUSTRATED)) {
      await page.goto(category(leaf));
      const card = page
        .getByTestId('category-card')
        .filter({ has: page.locator(`a[href="/producto/${productSlug}"]`) });
      await expect(card).toHaveCount(1);
      await expect(card.getByTestId('card-tile').locator('svg[data-testid="category-illustration"]')).toHaveCount(1);
      await expect(card.locator('a')).toHaveCount(1);
    }
  });

  test('opens a product from its card and lands on that product page', async ({ page }) => {
    await page.goto(category(OIL_FILTERS));
    const card = cardWithTitle(page, DEMO_SHARED.title);
    await card.getByTestId('card-title').click();
    await expect(page).toHaveURL(new RegExp(`/producto/${DEMO_SHARED.slug}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_SHARED.title);
  });

  test('walks the root pages: page 2 has previous and next, the last page has previous and no next', async ({
    page,
  }) => {
    const indicator = (n: number) =>
      messages.Category.pageIndicator.replace('{page}', String(n)).replace('{pages}', String(rootPages));
    await page.goto(category(ROOT));
    await expect(page.getByTestId('pagination-prev')).toHaveCount(0);
    await expect(page.getByTestId('pagination-indicator')).toHaveText(indicator(1));
    await expect(page.getByTestId('pagination-next')).toContainText(messages.Category.nextPage);
    await expect(page.getByTestId('pagination-next')).toHaveAttribute('href', category(ROOT, 2));

    await page.getByTestId('pagination-next').click();

    await expect(page).toHaveURL(new RegExp(`${category(ROOT, 2).replace('?', '\?')}$`));
    await expect(page.getByTestId('category-card')).toHaveCount(Math.min(PAGE_SIZE, rootCount - PAGE_SIZE));
    await expect(page.getByTestId('category-summary')).toHaveText(summaryText(rootCount, 2, rootPages));
    await expect(page.getByTestId('pagination-indicator')).toHaveText(indicator(2));
    await expect(page.getByTestId('pagination-prev')).toContainText(messages.Category.previousPage);
    await expect(page.getByTestId('pagination-prev')).toHaveAttribute('href', category(ROOT));
    expect(await page.title()).toBe(
      messages.Category.metaTitlePaged
        .replace('{category}', DEMO_CATEGORY_NAMES[ROOT])
        .replace('{page}', '2')
        .replace('{siteName}', siteName),
    );

    await page.goto(category(ROOT, rootPages));
    await expect(page.getByTestId('category-card')).toHaveCount(rootCount - PAGE_SIZE * (rootPages - 1));
    await expect(page.getByTestId('pagination-indicator')).toHaveText(indicator(rootPages));
    await expect(page.getByTestId('pagination-next')).toHaveCount(0);
    await expect(page.getByTestId('pagination-prev')).toHaveAttribute('href', rootPageUrls[rootPages - 2]);

    await page.goto(category(ROOT, 2));
    await page.getByTestId('pagination-prev').click();
    await expect(page).toHaveURL(new RegExp(`${category(ROOT)}$`));
    await expect(page.getByTestId('category-card')).toHaveCount(PAGE_SIZE);
  });

  test('later pages continue the order of the first without repeating a product', async ({ request, browser }) => {
    const titles: string[] = [];
    for (const target of rootPageUrls) {
      const { page, close } = await openRawHtml(browser, await (await request.get(target)).text());
      titles.push(...(await page.getByTestId('card-title').allTextContents()));
      await close();
    }
    expect(titles).toHaveLength(rootCount);
    expect(new Set(titles).size).toBe(rootCount);
  });

  test('shows the products of every child under the root, which holds none of its own', async ({ page }) => {
    await page.goto(category(ROOT));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_CATEGORY_NAMES[ROOT]);
    await expect(page.getByTestId('category-summary')).toContainText(
      icuPlural(messages.Category.summary, rootCount),
    );
    const titles = await page.getByTestId('card-title').allTextContents();
    for (const target of rootPageUrls.slice(1)) {
      await page.goto(target);
      titles.push(...(await page.getByTestId('card-title').allTextContents()));
    }
    expect(titles).toHaveLength(rootCount);
    expect(titles).toContain(DEMO_NO_BRAND.title);
    expect(titles).toContain(DEMO_SHARED.title);
    expect(titles).toContain(DEMO_LONG_TITLE.title);
  });

  test('counts a leaf on its own products only, below the root, with no pagination for one page', async ({
    page,
  }) => {
    const slug = 'filtros-de-aire';
    await page.goto(category(slug));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_CATEGORY_NAMES[slug]);
    await expect(page.getByTestId('category-card')).toHaveCount(DEMO_CATEGORY_COUNTS[slug]);
    await expect(page.getByTestId('category-summary')).toHaveText(summaryText(DEMO_CATEGORY_COUNTS[slug]));
    expect(DEMO_CATEGORY_COUNTS[slug]).toBeLessThan(rootCount);
    await expect(page.getByTestId('pagination')).toHaveCount(0);
    await expect(page.locator(`a[href="/producto/${DEMO_FOUR_OFFERS.slug}"]`)).toHaveCount(1);
  });

  for (const slug of ['filtros', 'automovil', 'herramientas']) {
    test(`the retired category /categoria/${slug} answers 404 with the not-found page and no redirect`, async ({
      request,
      page,
      context,
    }) => {
      const response = await request.get(category(slug), { maxRedirects: 0 });
      expect(response.status()).toBe(404);
      expectNoSetCookie(response);
      expect(await response.text()).toContain(messages.NotFound.heading);

      await page.goto(category(slug));
      await expect(page.getByRole('heading', { name: messages.NotFound.heading })).toBeVisible();
      expect(await context.cookies()).toEqual([]);
    });
  }

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
    const unmapped = [DEMO_UNMAPPED_CATEGORY, DEMO_UNMAPPED_EMPTY, DEMO_DRILL, DEMO_WRENCHES];
    for (const slug of Object.keys(DEMO_CATEGORY_COUNTS)) {
      for (const pageNumber of rootPageUrls.map((_url, index) => index + 1)) {
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
    const response = await page.goto(category(EMPTY_LEAF));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_CATEGORY_NAMES[EMPTY_LEAF]);
    await expect(page.getByTestId('category-empty')).toBeVisible();
    await expect(page.getByTestId('category-empty')).toContainText(messages.Category.emptyHeading);
    await expect(page.getByTestId('category-empty')).toContainText(messages.Category.emptyBody);
    await expect(page.getByTestId('category-card')).toHaveCount(0);
    await expect(page.getByTestId('category-summary')).toHaveCount(0);
    await expect(page.getByTestId('pagination')).toHaveCount(0);
    expect(await context.cookies()).toEqual([]);
  });

  test('answers 404 for page 2 of an empty category: it has exactly one page', async ({ request }) => {
    const response = await request.get(category(EMPTY_LEAF, 2));
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
    for (const pageNumber of [rootPages + 1, 99, '9'.repeat(400)]) {
      const response = await request.get(category(ROOT, pageNumber));
      expect(response.status(), String(pageNumber).slice(0, 12)).toBe(404);
      expectNoSetCookie(response);
    }
  });

  for (const value of ['abc', '0', '-1', '1.5', '', '1']) {
    test(`reads ?pagina=${JSON.stringify(value)} as page 1 at the same URL, without a redirect`, async ({
      request,
    }) => {
      const response = await request.get(`${category(ROOT)}?pagina=${encodeURIComponent(value)}`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain(
        messages.Category.pageIndicator.replace('{page}', '1').replace('{pages}', String(rootPages)),
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

    await page.goto(category(ROOT));
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
      await page.goto(category(ROOT));
      await page.getByTestId('category-card').first().waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // The long-title card stays inside the viewport; the title is clamped, not stretched.
      const all = rootPageUrls;
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
      await page.goto(category(ROOT));
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
      await page.goto(category(EMPTY_LEAF));
      await expect(page.getByTestId('category-empty')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
