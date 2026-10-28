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

    await expect(page).toHaveURL(new RegExp(`${category(ROOT, 2).replace('?', '\\?')}$`));
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

// ---------------------------------------------------------------------------
// S11.4: brand chips, sort form, spec line, no-match state (02-ux § Checks).
// Brands come from the demo import: filtros-de-aire has six brands of two
// products each, the root has fifteen, aceite-de-motor has seven.
// ---------------------------------------------------------------------------

const AIR = 'filtros-de-aire';
const OIL = 'aceite-de-motor';
const MANY_BRANDS = 15;
const VISIBLE_CHIPS = 8;
/** Brand of the root list that sits outside the first 8 chips (2 products). */
const LATE_BRAND = { slug: 'total', label: 'Total' };
const listing = (slug: string, query = '') => `/categoria/${slug}${query}`;
// The brand group renders two lists (S11.6): a short one below 40rem and a long one from it, the
// other hidden by CSS. The default viewport is 1280 wide, so the default list is the wide one; a
// phone test passes 'narrow'. Never select by the bare testid, it matches in both lists.
type ChipList = 'narrow' | 'wide';
const brandList = (page: Page, which: ChipList = 'wide') => page.getByTestId(`brand-chips-${which}`);
const brandChips = (page: Page, which: ChipList = 'wide') => brandList(page, which).getByTestId('brand-chip');
const chipAll = (page: Page, which: ChipList = 'wide') => brandList(page, which).getByTestId('brand-chip-all');
const chipMore = (page: Page, which: ChipList = 'wide') => brandList(page, which).getByTestId('brand-more');
const chipCount = async (chip: Locator): Promise<number> => {
  const label = (await chip.getAttribute('aria-label')) ?? '';
  const found = /: (\d+) producto/.exec(label);
  if (found === null) throw new Error(`no count in aria-label: ${label}`);
  return Number(found[1]);
};
const chipBrand = async (chip: Locator): Promise<string> =>
  ((await chip.getAttribute('aria-label')) ?? '').split(':')[0];
const parsePrice = (text: string): number =>
  Number(normaliseSpaces(text).replace(/[^\d,]/g, '').replace(',', '.'));
const cardTitles = (page: Page) => page.getByTestId('card-title').allTextContents();
const cardPrices = async (page: Page) =>
  (await page.getByTestId('card-price').allTextContents()).map(parsePrice);
const stripScripts = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/gi, '');

test.describe('category brand chips (S11.4, 02-ux checks 1 to 8)', () => {
  test('check 1: the chips, the count and the sort sit in one panel between the IVA note and the first card', async ({
    page,
  }) => {
    await page.goto(listing(AIR));
    const panel = page.getByTestId('category-panel');
    await expect(panel).toHaveCount(1);
    await expect(panel.getByTestId('brand-chips')).toHaveCount(1);
    await expect(panel.getByTestId('category-summary')).toHaveCount(1);
    await expect(panel.getByTestId('category-sort')).toHaveCount(1);

    const note = await page.getByText(messages.Product.vatIncluded, { exact: true }).boundingBox();
    const box = await panel.boundingBox();
    const firstCard = await page.getByTestId('category-card').first().boundingBox();
    expect(note!.y).toBeLessThan(box!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(firstCard!.y);
  });

  test('check 1: the panel is white on the canvas, not bare controls', async ({ page }) => {
    await page.goto(listing(AIR));
    const panelBackground = await page
      .getByTestId('category-panel')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    const canvas = await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(panelBackground).toBe('rgb(255, 255, 255)');
    expect(panelBackground).not.toBe(canvas);
  });

  test('check 2: the first chip is "Todas las marcas" and is the one selected on the unfiltered page', async ({
    page,
  }) => {
    await page.goto(listing(AIR));
    const group = brandList(page);
    await expect(group.getByRole('link').first()).toHaveAttribute('data-testid', 'brand-chip-all');
    await expect(chipAll(page)).toHaveText(messages.Category.brandAll);
    await expect(chipAll(page)).toHaveAttribute('aria-current', 'true');
    await expect(group.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(page.getByTestId('brand-chips').getByText(messages.Category.brandGroupLabel, { exact: true })).toBeVisible();
    await expect(group.getByRole('list', { name: messages.Category.brandGroupLabel })).toHaveCount(1);
  });

  test('check 3: each chip count equals the cards after pressing it, and the chip counts add up to the category', async ({
    page,
  }) => {
    await page.goto(listing(AIR));
    const n = await brandChips(page).count();
    expect(n).toBe(6);
    let total = 0;
    for (let index = 0; index < n; index += 1) {
      await page.goto(listing(AIR));
      const chip = brandChips(page).nth(index);
      const expected = await chipCount(chip);
      const brand = await chipBrand(chip);
      total += expected;
      await expect(chip).toContainText(brand);
      await chip.click();
      await expect(page.getByTestId('category-card')).toHaveCount(expected);
      await expect(page.getByTestId('category-summary')).toHaveText(summaryText(expected));
      for (const cardBrand of await page.getByTestId('card-brand').allTextContents()) {
        expect(cardBrand).toBe(brand);
      }
    }
    expect(total).toBe(DEMO_CATEGORY_COUNTS[AIR]);
  });

  test('check 4: ?marca=bosch selects the Bosch chip, lists only Bosch and carries no pagina', async ({ page }) => {
    await page.goto(listing(AIR, '?marca=bosch'));
    const selected = brandList(page).locator('[aria-current="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute('data-testid', 'brand-chip');
    expect(await chipBrand(selected)).toBe('Bosch');
    expect(await selected.getAttribute('aria-label')).toContain(
      messages.Category.brandChipSelectedLabel.split('. ')[1],
    );
    const cards = await page.getByTestId('category-card').count();
    expect(cards).toBeGreaterThan(0);
    await expect(page.getByTestId('category-summary')).toHaveText(summaryText(cards));
    expect(await page.getByTestId('card-brand').allTextContents()).toEqual(Array(cards).fill('Bosch'));
    expect(new URL(page.url()).searchParams.has('pagina')).toBe(false);
    await expect(chipAll(page)).not.toHaveAttribute('aria-current', 'true');
  });

  test('check 5: pressing the selected chip returns to the clean unfiltered URL', async ({ page }) => {
    await page.goto(listing(AIR, '?marca=bosch'));
    await brandList(page).locator('[aria-current="true"]').click();
    await expect(page).toHaveURL(new RegExp(`${listing(AIR)}$`));
    await expect(page.getByTestId('category-card')).toHaveCount(DEMO_CATEGORY_COUNTS[AIR]);
  });

  test('check 5: "Todas las marcas" drops the brand and keeps the sort', async ({ page }) => {
    await page.goto(listing(AIR, '?marca=bosch&orden=nombre'));
    await chipAll(page).click();
    await expect(page).toHaveURL(new RegExp(`${listing(AIR, '\\?orden=nombre')}$`));
  });

  test('check 6: the root shows 8 chips and "Más marcas (7)", which holds the other 7', async ({ page }) => {
    await page.goto(listing(ROOT));
    const more = chipMore(page);
    await expect(more).toHaveCount(1);
    await expect(more.locator('summary')).toContainText(
      messages.Category.brandMore.replace('{count}', String(MANY_BRANDS - VISIBLE_CHIPS)),
    );
    await expect(brandChips(page)).toHaveCount(MANY_BRANDS);
    await expect(brandList(page).locator('> ul > li > a[data-testid="brand-chip"]')).toHaveCount(
      VISIBLE_CHIPS,
    );
    await expect(more.getByTestId('brand-chip')).toHaveCount(MANY_BRANDS - VISIBLE_CHIPS);
    // Closed until pressed: the overflow chips are not visible, then are.
    await expect(more).not.toHaveAttribute('open', '');
    await expect(more.getByTestId('brand-chip').first()).toBeHidden();
    await more.locator('summary').click();
    await expect(more.getByTestId('brand-chip').first()).toBeVisible();
    await expect(more.getByTestId('brand-chip')).toHaveCount(MANY_BRANDS - VISIBLE_CHIPS);
  });

  test('check 7: a selected brand outside the first 8 opens "Más marcas" with its chip visible', async ({ page }) => {
    await page.goto(listing(ROOT, `?marca=${LATE_BRAND.slug}`));
    const more = chipMore(page);
    await expect(more).toHaveAttribute('open', '');
    const selected = more.locator('[aria-current="true"]');
    await expect(selected).toBeVisible();
    expect(await chipBrand(selected)).toBe(LATE_BRAND.label);
  });

  test('check 7: a selected brand in the first 8 leaves "Más marcas" closed', async ({ page }) => {
    await page.goto(listing(ROOT, '?marca=bosch'));
    await expect(chipMore(page)).not.toHaveAttribute('open', '');
  });

  test('check 8: a category with 7 brands shows no "Más marcas" control', async ({ page }) => {
    await page.goto(listing(OIL));
    await expect(brandChips(page)).toHaveCount(7);
    await expect(chipMore(page)).toHaveCount(0);
  });

  test('the brand count in each chip is the same number the chip name carries on the root', async ({ page }) => {
    await page.goto(listing(ROOT));
    await chipMore(page).locator('summary').click();
    let total = 0;
    for (const chip of await brandChips(page).all()) total += await chipCount(chip);
    // Every demo product has a brand except the one without, so the chips cover all but that one.
    expect(total).toBe(DEMO_CATEGORY_COUNTS[ROOT] - 1);
  });

  test('a chip keeps the current sort and drops the page', async ({ page }) => {
    await page.goto(listing(ROOT, '?orden=precio-desc&pagina=2'));
    const href = await brandChips(page).first().getAttribute('href');
    const url = new URL(href as string, 'http://x.test');
    expect(url.searchParams.get('orden')).toBe('precio-desc');
    expect(url.searchParams.has('pagina')).toBe(false);
    expect(url.searchParams.get('marca')).not.toBeNull();
    // Params in the fixed order marca, orden.
    expect([...url.searchParams.keys()]).toEqual(['marca', 'orden']);
  });
});

test.describe('category sort form (S11.4, 02-ux checks 9 to 15)', () => {
  test('check 9 and 10: label, select and submit show with JavaScript off, with the three options in order', async ({
    request,
    browser,
  }) => {
    const { page, close } = await openRawHtml(browser, await (await request.get(listing(AIR))).text());
    await expect(page.getByLabel(messages.Category.sortLabel)).toHaveCount(1);
    await expect(page.getByTestId('category-sort-submit')).toHaveText(messages.Category.sortSubmit);
    const select = page.getByTestId('category-sort-select');
    expect(await select.locator('option').allTextContents()).toEqual([
      messages.Category.sortPriceAsc,
      messages.Category.sortPriceDesc,
      messages.Category.sortName,
    ]);
    expect(await select.locator('option').evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value))).toEqual(
      ['precio-asc', 'precio-desc', 'nombre'],
    );
    await expect(select).toHaveValue('precio-asc');
    await close();
  });

  test('check 9: label, select and button are visible at 390 and 1280', async ({ page }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(listing(AIR));
      await expect(page.getByText(messages.Category.sortLabel, { exact: true })).toBeVisible();
      await expect(page.getByTestId('category-sort-select')).toBeVisible();
      await expect(page.getByTestId('category-sort-submit')).toBeVisible();
    }
  });

  test('checks 11 and 25: with JavaScript off, Precio de mayor a menor reloads dearest first, sets no cookie and requests no /go', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    await page.goto(listing(AIR));
    const ascending = await cardPrices(page);
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

    await page.getByTestId('category-sort-select').selectOption({ label: messages.Category.sortPriceDesc });
    await page.getByTestId('category-sort-submit').click();

    await expect(page).toHaveURL(/\/categoria\/filtros-de-aire\?orden=precio-desc$/);
    await expect(page.getByTestId('category-sort-select')).toHaveValue('precio-desc');
    const descending = await cardPrices(page);
    expect(descending).toHaveLength(DEMO_CATEGORY_COUNTS[AIR]);
    expect(descending).toEqual([...descending].sort((a, b) => b - a));
    expect(descending[0]).toBe(Math.max(...ascending));

    // The control worked with no script, and used no cookie and no click link.
    expect(await context.cookies()).toEqual([]);
    expect(requested.filter((url) => new URL(url).pathname.startsWith('/go/'))).toEqual([]);
    await context.close();
  });

  test('check 11: the no-JS form keeps working back to the default, and ?orden=precio-asc renders as the default', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto(listing(AIR, '?orden=precio-desc'));
    await page.getByTestId('category-sort-select').selectOption({ label: messages.Category.sortPriceAsc });
    await page.getByTestId('category-sort-submit').click();
    await expect(page).toHaveURL(/orden=precio-asc$/);
    const prices = await cardPrices(page);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    await expect(page.getByTestId('category-sort-select')).toHaveValue('precio-asc');
    await context.close();
  });

  test('check 12: Nombre lists titles in alphabetical order, accents and case ignored', async ({ page }) => {
    await page.goto(listing(OIL, '?orden=nombre'));
    await expect(page.getByTestId('category-sort-select')).toHaveValue('nombre');
    const titles = await cardTitles(page);
    expect(titles).toHaveLength(DEMO_CATEGORY_COUNTS[OIL]);
    const collator = new Intl.Collator('und', { sensitivity: 'base' });
    expect(titles).toEqual([...titles].sort((a, b) => collator.compare(a, b)));
    // The order differs from the price order, so the sort did something.
    await page.goto(listing(OIL));
    expect(await cardTitles(page)).not.toEqual(titles);
  });

  test('check 13: sorting while a brand is selected keeps the brand chip and the brand cards (no JS)', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto(listing(AIR, '?marca=bosch'));
    const before = (await cardTitles(page)).sort();
    await page.getByTestId('category-sort-select').selectOption({ label: messages.Category.sortName });
    await page.getByTestId('category-sort-submit').click();

    const url = new URL(page.url());
    expect(url.searchParams.get('marca')).toBe('bosch');
    expect(url.searchParams.get('orden')).toBe('nombre');
    expect(url.searchParams.has('pagina')).toBe(false);
    await expect(brandList(page).locator('[aria-current="true"]')).toHaveCount(1);
    expect(await chipBrand(brandList(page).locator('[aria-current="true"]'))).toBe('Bosch');
    expect((await cardTitles(page)).sort()).toEqual(before);
    await context.close();
  });

  test('check 13: a chip pressed while a sort is chosen keeps the sort', async ({ page }) => {
    await page.goto(listing(AIR, '?orden=precio-desc'));
    await brandChips(page).first().click();
    expect(new URL(page.url()).searchParams.get('orden')).toBe('precio-desc');
    await expect(page.getByTestId('category-sort-select')).toHaveValue('precio-desc');
  });

  test('check 14: changing the sort on page 2 lands on page 1 with no pagina', async ({ page }) => {
    await page.goto(listing(ROOT, '?pagina=2'));
    await expect(page.getByTestId('pagination-indicator')).toContainText('2');
    await page.getByTestId('category-sort-select').selectOption({ label: messages.Category.sortName });
    await page.getByTestId('category-sort-submit').click();
    await expect(page).toHaveURL(/orden=nombre/);
    expect(new URL(page.url()).searchParams.has('pagina')).toBe(false);
    await expect(page.getByTestId('pagination-indicator')).toHaveText(
      messages.Category.pageIndicator.replace('{page}', '1').replace('{pages}', String(rootPages)),
    );
  });

  test('check 14: pressing a chip on page 2 lands on page 1 with no pagina', async ({ page }) => {
    await page.goto(listing(ROOT, '?pagina=2'));
    await brandChips(page).first().click();
    expect(new URL(page.url()).searchParams.has('pagina')).toBe(false);
    await expect(page.getByTestId('pagination-indicator')).toHaveCount(0);
  });

  test('check 15 (the part the demo can reach): the pagination links of a sorted root keep orden, in the fixed order', async ({
    page,
  }) => {
    await page.goto(listing(ROOT, '?orden=nombre'));
    await expect(page.getByTestId('pagination-next')).toHaveAttribute('href', listing(ROOT, '?orden=nombre&pagina=2'));
    await page.getByTestId('pagination-next').click();
    await expect(page.getByTestId('pagination-prev')).toHaveAttribute('href', listing(ROOT, '?orden=nombre'));
    await expect(page.getByTestId('category-sort-select')).toHaveValue('nombre');
  });

  test('a sorted root walks every page without repeating a product, for each sort', async ({ request, browser }) => {
    for (const orden of ['precio-asc', 'precio-desc', 'nombre']) {
      const titles: string[] = [];
      for (let index = 1; index <= rootPages; index += 1) {
        const query = `?orden=${orden}${index > 1 ? `&pagina=${index}` : ''}`;
        const { page, close } = await openRawHtml(browser, await (await request.get(listing(ROOT, query))).text());
        titles.push(...(await cardTitles(page)));
        await close();
      }
      expect(titles, orden).toHaveLength(rootCount);
      expect(new Set(titles).size, orden).toBe(rootCount);
    }
  });

  test('the price sorts are exact mirrors of each other over the whole root (ties aside)', async ({ request, browser }) => {
    const pricesOf = async (orden: string) => {
      const out: number[] = [];
      for (let index = 1; index <= rootPages; index += 1) {
        const query = `?orden=${orden}${index > 1 ? `&pagina=${index}` : ''}`;
        const { page, close } = await openRawHtml(browser, await (await request.get(listing(ROOT, query))).text());
        out.push(...(await cardPrices(page)));
        await close();
      }
      return out;
    };
    const asc = await pricesOf('precio-asc');
    const desc = await pricesOf('precio-desc');
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(desc).toEqual([...asc].reverse());
  });
});

test.describe('category spec line and cards (S11.4, 02-ux checks 19 to 21)', () => {
  test('check 19: a product with a part number shows "Ref. <number>" and one without shows no spec line', async ({
    page,
  }) => {
    await page.goto(listing(OIL_FILTERS));
    const withPart = cardWithTitle(page, DEMO_SHARED.title);
    await expect(withPart.getByTestId('card-spec')).toHaveText(
      messages.Category.specRef.replace('{partNumber}', DEMO_SHARED.partNumber),
    );

    await page.goto(listing(DEMO_NO_BRAND.categorySlug));
    const without = cardWithTitle(page, DEMO_NO_BRAND.title);
    await expect(without.getByTestId('card-spec')).toHaveCount(0);
    expect(await without.innerText()).not.toMatch(/Ref\.|null|undefined/);
  });

  test('check 19: every spec line on the root is "Ref. " plus text, and the title sits above it', async ({ page }) => {
    await page.goto(listing(ROOT));
    const specs = await page.getByTestId('card-spec').allTextContents();
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(spec).toMatch(/^Ref\. \S/);
    const first = page.getByTestId('category-card').filter({ has: page.getByTestId('card-spec') }).first();
    const title = await first.getByTestId('card-title').boundingBox();
    const spec = await first.getByTestId('card-spec').boundingBox();
    expect(spec!.y).toBeGreaterThan(title!.y);
  });

  test('check 20: a one-shop card shows no "Desde" and "1 tienda", a multi-shop card shows "Desde"', async ({
    page,
  }) => {
    await page.goto(listing(AIR));
    const multi = page
      .getByTestId('category-card')
      .filter({ has: page.locator(`a[href="/producto/${DEMO_FOUR_OFFERS.slug}"]`) });
    await expect(multi.getByTestId('card-price-from')).toHaveText(messages.Category.priceFrom);
    const single = page.getByTestId('category-card').filter({ has: page.getByText(icuPlural(messages.Product.shopCount, 1), { exact: true }) });
    expect(await single.count()).toBeGreaterThan(0);
    await expect(single.first().getByTestId('card-price-from')).toHaveCount(0);
  });

  test('check 21: the card with no brand has no brand element, and the 100-character title stays inside its card', async ({
    page,
  }) => {
    await page.goto(listing(DEMO_NO_BRAND.categorySlug));
    const card = cardWithTitle(page, DEMO_NO_BRAND.title);
    await expect(card.getByTestId('card-brand')).toHaveCount(0);

    for (const target of rootPageUrls) {
      await page.goto(target);
      const long = cardWithTitle(page, DEMO_LONG_TITLE.title.slice(0, 40));
      if ((await long.count()) === 0) continue;
      const cardBox = await long.first().boundingBox();
      const titleBox = await long.first().getByTestId('card-title').boundingBox();
      const priceBox = await long.first().getByTestId('card-price').boundingBox();
      expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height);
      expect(priceBox!.y + priceBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height);
      return;
    }
    throw new Error('the long-title demo product was not on any root page');
  });
});

test.describe('category no-match, malformed parameters and empty states (S11.4, 02-ux checks 22 to 25, 28)', () => {
  test('check 22: an unknown brand answers 200 with the panel, 0 productos, no sort and the no-match message', async ({
    page,
    context,
  }) => {
    const response = await page.goto(listing(AIR, '?marca=no-existe'));
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('category-panel')).toBeVisible();
    await expect(page.getByTestId('category-summary')).toHaveText(summaryText(0));
    await expect(page.getByTestId('category-sort')).toHaveCount(0);
    await expect(page.getByTestId('category-card')).toHaveCount(0);
    await expect(page.getByTestId('pagination')).toHaveCount(0);
    await expect(brandList(page).locator('[aria-current="true"]')).toHaveCount(0);
    const empty = page.getByTestId('category-empty');
    await expect(empty).toContainText(messages.Category.noMatchHeading);
    await expect(empty).toContainText(messages.Category.noMatchBody);
    await expect(empty.getByTestId('category-empty-action')).toHaveText(messages.Category.noMatchAction);
    expect(await context.cookies()).toEqual([]);
  });

  test('check 22: the "Quitar el filtro" button leads to the clean category URL, keeping a chosen sort', async ({
    page,
  }) => {
    await page.goto(listing(AIR, '?marca=no-existe'));
    await expect(page.getByTestId('category-empty-action')).toHaveAttribute('href', listing(AIR));
    await page.getByTestId('category-empty-action').click();
    await expect(page).toHaveURL(new RegExp(`${listing(AIR)}$`));
    await expect(page.getByTestId('category-card')).toHaveCount(DEMO_CATEGORY_COUNTS[AIR]);

    await page.goto(listing(AIR, '?marca=no-existe&orden=nombre'));
    await expect(page.getByTestId('category-empty-action')).toHaveAttribute('href', listing(AIR, '?orden=nombre'));
  });

  test('check 22: the brand text from the URL is never echoed in the page', async ({ request }) => {
    const marker = 'zz-marca-marcador';
    const response = await request.get(listing(AIR, `?marca=${marker}`));
    expect(response.status()).toBe(200);
    expectNoSetCookie(response);
    expect(stripScripts(await response.text())).not.toContain(marker);
  });

  test('check 22: no-match on page 2 is a 404, and a brand past its last page is a 404', async ({ request }) => {
    expect((await request.get(listing(AIR, '?marca=no-existe&pagina=2'))).status()).toBe(404);
    // Bosch fits one page in filtros-de-aire.
    expect((await request.get(listing(AIR, '?marca=bosch&pagina=2'))).status()).toBe(404);
  });

  test('check 22: a filter on a category with no products still shows the plain empty state, not no-match', async ({
    page,
  }) => {
    await page.goto(listing(EMPTY_LEAF, '?marca=bosch'));
    await expect(page.getByTestId('category-empty')).toContainText(messages.Category.emptyHeading);
    await expect(page.getByTestId('category-empty')).not.toContainText(messages.Category.noMatchHeading);
    await expect(page.getByTestId('category-empty-action')).toHaveCount(0);
    await expect(page.getByTestId('category-panel')).toHaveCount(0);
  });

  for (const [name, query] of [
    ['?marca=!!', '?marca=!!'],
    ['?marca=BOSCH (upper case)', '?marca=BOSCH'],
    ['?marca= (empty)', '?marca='],
    ['?marca=a&marca=b (repeated)', '?marca=bosch&marca=mahle'],
    ['?orden=zzz', '?orden=zzz'],
    ['?orden=price-desc (the code name)', '?orden=price-desc'],
    ['?orden=a&orden=b (repeated)', '?orden=nombre&orden=precio-desc'],
    ['both malformed', '?marca=!!&orden=zzz'],
  ] as const) {
    test(`check 23: ${name} renders the default list as if unset`, async ({ request, browser }) => {
      const response = await request.get(listing(AIR, query), { maxRedirects: 0 });
      expect(response.status()).toBe(200);
      expectNoSetCookie(response);
      const { page, close } = await openRawHtml(browser, await response.text());
      await expect(page.getByTestId('category-card')).toHaveCount(DEMO_CATEGORY_COUNTS[AIR]);
      await expect(page.getByTestId('category-empty')).toHaveCount(0);
      await expect(page.getByTestId('category-sort-select')).toHaveValue('precio-asc');
      await expect(chipAll(page)).toHaveAttribute('aria-current', 'true');
      const prices = await cardPrices(page);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
      await close();
    });
  }

  test('check 24: the empty category has no panel, chips, count or sort', async ({ page }) => {
    await page.goto(listing(EMPTY_LEAF));
    await expect(page.getByTestId('category-empty')).toBeVisible();
    for (const id of ['category-panel', 'brand-chips', 'brand-chip', 'category-sort', 'category-summary']) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
  });

  test('check 28: a demo category carries no canonical and is noindex, on ?marca= and ?orden= as on the bare URL', async ({
    request,
    browser,
  }) => {
    for (const query of ['', '?marca=bosch', '?orden=nombre', '?marca=bosch&orden=nombre', '?marca=no-existe']) {
      const response = await request.get(listing(AIR, query));
      expect(response.status(), query).toBe(200);
      const { page, close } = await openRawHtml(browser, await response.text());
      await expect(page.locator('link[rel="canonical"]'), query).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]'), query).toHaveAttribute('content', /noindex/);
      await close();
    }
  });
});

test.describe('category controls: keyboard and size (S11.4, 02-ux checks 26 and 27)', () => {
  test('check 27: Tab goes chips in order, then the select, the button, then the cards, each with a visible ring', async ({
    page,
  }) => {
    await page.goto(listing(AIR));
    const order: string[] = [];
    const ringOf = () =>
      page.evaluate(() => {
        const node = document.activeElement as HTMLElement;
        // A card link draws its ring on the stretched ::after box, around the whole card.
        const own = getComputedStyle(node);
        const style = own.outlineStyle === 'none' ? getComputedStyle(node, '::after') : own;
        return {
          id: node.getAttribute('data-testid') ?? node.tagName,
          width: parseFloat(style.outlineWidth),
          outline: style.outlineStyle,
        };
      });
    await chipAll(page).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const stops = 1 + 6 + 1 + 1 + 1; // all, six chips, select, button, first card title
    for (let index = 0; index < stops; index += 1) {
      const ring = await ringOf();
      order.push(ring.id);
      expect(ring.outline, `${ring.id} at stop ${index}`).not.toBe('none');
      expect(ring.width, `${ring.id} at stop ${index}`).toBeGreaterThanOrEqual(3);
      if (index < stops - 1) await page.keyboard.press('Tab');
    }
    expect(order).toEqual([
      'brand-chip-all',
      ...Array(6).fill('brand-chip'),
      'category-sort-select',
      'category-sort-submit',
      'card-title',
    ]);
  });

  test.describe('at 390 wide', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    for (const [name, query] of [
      ['unfiltered', ''],
      ['filtered', '?marca=bosch'],
      ['no-match', '?marca=no-existe'],
    ] as const) {
      test(`check 26: the ${name} page does not scroll sideways`, async ({ page }) => {
        await page.goto(listing(AIR, query));
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }

    test('check 26: the open overflow of the root does not scroll sideways', async ({ page }) => {
      await page.goto(listing(ROOT, `?marca=${LATE_BRAND.slug}`));
      await expect(chipMore(page, 'narrow')).toHaveAttribute('open', '');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('check 26: chips, select and buttons are at least 44px high', async ({ page }) => {
      await page.goto(listing(AIR));
      const controls: Locator[] = [
        chipAll(page, 'narrow'),
        ...(await brandChips(page, 'narrow').filter({ visible: true }).all()),
        page.getByTestId('category-sort-select'),
        page.getByTestId('category-sort-submit'),
      ];
      for (const control of controls) {
        const box = await control.boundingBox();
        expect(box!.height, (await control.textContent())?.trim()).toBeGreaterThanOrEqual(44);
      }
      // Phone: the narrow list shows 2 brands, so the root and a leaf both carry the control.
      await page.goto(listing(ROOT));
      const summary = (await chipMore(page, 'narrow').locator('summary').boundingBox())!;
      expect(summary.height).toBeGreaterThanOrEqual(44);
      await page.goto(listing(AIR, '?marca=no-existe'));
      expect((await page.getByTestId('category-empty-action').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });

    test('check 18: one column and the row card', async ({ page }) => {
      await page.goto(listing(AIR));
      const xs = new Set<number>();
      for (const card of await page.getByTestId('category-card').all()) xs.add(Math.round((await card.boundingBox())!.x));
      expect(xs.size).toBe(1);
      // Row card: the tile sits left of the title, on the same band.
      const first = page.getByTestId('category-card').first();
      const tile = (await first.getByTestId('card-tile').boundingBox())!;
      const title = (await first.getByTestId('card-title').boundingBox())!;
      expect(tile.x + tile.width).toBeLessThanOrEqual(title.x);
    });
  });

  test.describe('at 768 wide', () => {
    test.use({ viewport: { width: 768, height: 900 } });

    test('check 18: two columns and the vertical card', async ({ page }) => {
      await page.goto(listing(AIR));
      const xs = new Set<number>();
      for (const card of await page.getByTestId('category-card').all()) xs.add(Math.round((await card.boundingBox())!.x));
      expect(xs.size).toBe(2);
      const first = page.getByTestId('category-card').first();
      const tile = (await first.getByTestId('card-tile').boundingBox())!;
      const title = (await first.getByTestId('card-title').boundingBox())!;
      expect(tile.y + tile.height).toBeLessThanOrEqual(title.y);
    });
  });

  test.describe('at 1280 wide', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('check 17: three columns of equal width and prices on one baseline across a row', async ({ page }) => {
      await page.goto(listing(ROOT));
      const cards = await page.getByTestId('category-card').all();
      const boxes = await Promise.all(cards.slice(0, 6).map((card) => card.boundingBox()));
      const xs = [...new Set(boxes.map((box) => Math.round(box!.x)))];
      expect(xs).toHaveLength(3);
      const widths = new Set(boxes.map((box) => Math.round(box!.width)));
      expect(widths.size).toBe(1);

      const prices = await Promise.all(cards.slice(0, 3).map((card) => card.getByTestId('card-price').boundingBox()));
      const ys = prices.map((box) => Math.round(box!.y + box!.height));
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
// S11.6: the category breadcrumb (03-ux § 8 checks 19 to 22).
// ---------------------------------------------------------------------------

test.describe('category breadcrumb (S11.6)', () => {
  for (const [name, slug, query] of [
    ['a leaf', AIR, ''],
    ['an empty leaf', EMPTY_LEAF, ''],
    ['a brand filter', AIR, '?marca=bosch'],
    ['a no-match', AIR, '?marca=no-existe'],
    ['a sort', AIR, '?orden=nombre'],
  ] as const) {
    test(`${name}: one crumb to the root category, named, before the title`, async ({ page }) => {
      await page.goto(listing(slug, query));
      const nav = page.getByTestId('breadcrumb');
      await expect(nav).toHaveCount(1);
      await expect(nav).toHaveAttribute('aria-label', messages.Product.breadcrumbLabel);
      const links = nav.getByRole('link');
      await expect(links).toHaveCount(1);
      await expect(links).toHaveText(DEMO_CATEGORY_NAMES[ROOT]);
      await expect(links).toHaveAttribute('href', category(ROOT));

      // Before the h1 in reading order and on screen, and a 44px target.
      const navBox = (await nav.boundingBox())!;
      const h1Box = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
      expect(navBox.y + navBox.height).toBeLessThanOrEqual(h1Box.y);
      expect((await links.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
  }

  test('the crumb link is clean: no pagina, marca or orden, whatever the current URL', async ({ page }) => {
    await page.goto(listing(AIR, '?marca=bosch&orden=nombre'));
    expect(await page.getByTestId('breadcrumb').getByRole('link').getAttribute('href')).toBe(category(ROOT));
  });

  test('the root category has no breadcrumb, on any of its pages', async ({ page }) => {
    for (const url of [...rootPageUrls, listing(ROOT, '?orden=nombre'), listing(ROOT, '?marca=bosch')]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 }), url).toBeVisible();
      await expect(page.getByTestId('breadcrumb'), url).toHaveCount(0);
    }
  });

  test('the crumb is the first stop after the site link, before the brand chips', async ({ page }) => {
    await page.goto(listing(AIR));
    await page.getByTestId('site-header-link').focus();
    await page.keyboard.press('Tab');
    const active = page.locator(':focus');
    await expect(active).toHaveText(DEMO_CATEGORY_NAMES[ROOT]);
    await expect(active).toHaveAttribute('href', category(ROOT));
  });

  test('the crumb leads to the root category page, which has no crumb', async ({ page }) => {
    await page.goto(listing(AIR));
    await page.getByTestId('breadcrumb').getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`${category(ROOT)}$`));
    await expect(page.getByTestId('breadcrumb')).toHaveCount(0);
  });
});

// The sort labels are the shortened S11.6 strings; pin them once, here, in the browser.
test.describe('category sort labels (S11.6)', () => {
  test('the options read Menor precio, Mayor precio, Nombre (A a Z) under Ordenar por', async ({ page }) => {
    await page.goto(listing(AIR));
    await expect(page.getByLabel('Ordenar por')).toHaveCount(1);
    expect(await page.getByTestId('category-sort-select').locator('option').allTextContents()).toEqual([
      'Menor precio',
      'Mayor precio',
      'Nombre (A a Z)',
    ]);
  });
});

// The phone list shows 2 brands, the desktop list 8; only the visible one is on screen.
test.describe('category brand chips, two lists (S11.6)', () => {
  test.describe('at 375 wide', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('the narrow list is visible and the wide one is not, with the control counting the rest', async ({ page }) => {
      await page.goto(listing(ROOT));
      await expect(brandList(page, 'narrow')).toBeVisible();
      await expect(brandList(page, 'wide')).toBeHidden();
      await expect(brandChips(page, 'narrow').filter({ visible: true })).toHaveCount(2);
      await expect(chipMore(page, 'narrow').locator('summary')).toContainText(
        messages.Category.brandMore.replace('{count}', String(MANY_BRANDS - 2)),
      );
    });

    test('a leaf shows 2 brands and the control with the other 4', async ({ page }) => {
      await page.goto(listing(AIR));
      await expect(brandChips(page, 'narrow').filter({ visible: true })).toHaveCount(2);
      await expect(chipMore(page, 'narrow').locator('summary')).toContainText(
        messages.Category.brandMore.replace('{count}', '4'),
      );
    });

    test('a brand outside the first 2 opens the narrow control with its chip visible', async ({ page }) => {
      await page.goto(listing(ROOT, `?marca=${LATE_BRAND.slug}`));
      await expect(chipMore(page, 'narrow')).toHaveAttribute('open', '');
      const selected = brandList(page, 'narrow').locator('[aria-current="true"]');
      await expect(selected).toBeVisible();
      expect(await chipBrand(selected)).toBe(LATE_BRAND.label);
    });

    test('Tab through the group stops only on chips that are on screen', async ({ page }) => {
      await page.goto(listing(AIR));
      await chipAll(page, 'narrow').focus();
      for (let stop = 0; stop < 4; stop += 1) {
        const onScreen = await page.evaluate(() => {
          const box = (document.activeElement as HTMLElement).getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
        expect(onScreen, `stop ${stop}`).toBe(true);
        await page.keyboard.press('Tab');
      }
    });
  });

  test.describe('at 1280 wide', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the wide list is visible and the narrow one is not', async ({ page }) => {
      await page.goto(listing(ROOT));
      await expect(brandList(page, 'wide')).toBeVisible();
      await expect(brandList(page, 'narrow')).toBeHidden();
      await expect(brandList(page, 'wide').locator('> ul > li > a[data-testid="brand-chip"]')).toHaveCount(
        VISIBLE_CHIPS,
      );
    });

    test('a leaf with six brands shows all six in the row and no control', async ({ page }) => {
      await page.goto(listing(AIR));
      await expect(brandChips(page, 'wide').filter({ visible: true })).toHaveCount(6);
      await expect(chipMore(page, 'wide')).toHaveCount(0);
    });
  });

  test('both lists are in the server HTML with JavaScript off', async ({ request, browser }) => {
    const { page, close } = await openRawHtml(browser, await (await request.get(listing(AIR))).text());
    await expect(page.getByTestId('brand-chips-narrow')).toHaveCount(1);
    await expect(page.getByTestId('brand-chips-wide')).toHaveCount(1);
    await close();
  });
});

// ---------------------------------------------------------------------------
// S11.6 CR-4: the sort select and "Ordenar" share one row, and the first card
// of a populated category starts high enough on a phone to show a product.
// ---------------------------------------------------------------------------

test.describe('category sort row and first card geometry (S11.6, CR-4)', () => {
  for (const [width, height] of [
    [375, 812],
    [390, 844],
    [1280, 800],
  ] as const) {
    test.describe(`at ${width}x${height}`, () => {
      test.use({ viewport: { width, height } });

      for (const slug of [ROOT, AIR]) {
        test(`${slug}: the select and the Ordenar button share one top`, async ({ page }) => {
          await page.goto(listing(slug));
          const select = (await page.getByTestId('category-sort-select').boundingBox())!;
          const submit = (await page.getByTestId('category-sort-submit').boundingBox())!;
          expect(Math.abs(select.y - submit.y)).toBeLessThanOrEqual(1);
        });
      }
    });
  }

  for (const [width, height] of [
    [375, 812],
    [390, 844],
  ] as const) {
    test.describe(`first card on a ${width}x${height} phone`, () => {
      test.use({ viewport: { width, height } });

      for (const slug of [ROOT, AIR]) {
        test(`${slug}: the first card top is at most 700 and its title starts inside the first view`, async ({
          page,
        }) => {
          await page.goto(listing(slug));
          const card = (await page.getByTestId('category-card').first().boundingBox())!;
          expect(card.y).toBeLessThanOrEqual(700);
          const title = (await page.getByTestId('card-title').first().boundingBox())!;
          expect(title.y).toBeLessThan(height);
        });
      }
    });
  }
});
