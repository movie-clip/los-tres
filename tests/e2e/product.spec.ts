import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import {
  DEMO_CATEGORY_NAMES,
  DEMO_FOUR_OFFERS,
  DEMO_NO_BRAND,
  DEMO_SHARED,
  DEMO_SHOP_HOSTS,
} from '../fixtures/demo';
import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import { loadEnv } from '../support/env';
import { dateMessagePattern, icuPlural, normaliseSpaces } from '../support/messages';
import {
  expectLocalScriptsAndLinks,
  expectNoForeignOrigin,
  expectNoSetCookie,
  openRawHtml,
} from '../support/page-checks';

loadEnv();
const siteName = (process.env.SITE_NAME ?? '').trim();

const path = (slug: string) => `/producto/${slug}`;
const text = async (page: Page, testId: string) =>
  (await page.getByTestId(testId).allTextContents()).map((value) => normaliseSpaces(value.trim()));

test.describe('product page /producto/<slug> (C-13)', () => {
  test('server-renders the shared-EAN product with JavaScript off and no cookie', async ({
    request,
    browser,
  }) => {
    const response = await request.get(path(DEMO_SHARED.slug));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expectNoSetCookie(response);
    const html = await response.text();

    const { page, close } = await openRawHtml(browser, html);

    await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(DEMO_SHARED.title);
    expect(await page.title()).toBe(
      messages.Product.metaTitle.replace('{title}', DEMO_SHARED.title).replace('{siteName}', siteName),
    );

    // The square carries the drawing of the product's own category, labelled as an illustration.
    await expect(page.locator('div[role="img"]')).toHaveAttribute(
      'aria-label',
      messages.Product.imageByCategory[DEMO_SHARED.categorySlug],
    );
    await expect(page.locator('div[role="img"] svg[data-testid="category-illustration"]')).toHaveCount(1);

    // Referencia and EAN as dt/dd pairs; the brand is its own line above the title, not a pair.
    const terms = await page.locator('dl dt').allTextContents();
    const values = await page.locator('dl dd').allTextContents();
    expect(terms).toEqual([messages.Product.partNumber, messages.Product.ean]);
    expect(values).toEqual([DEMO_SHARED.partNumber, DEMO_SHARED.ean]);
    await expect(page.getByTestId('product-brand')).toHaveText(DEMO_SHARED.brand);

    // The description sits in its own section after the offers (the demo feeds say the product is fictional).
    await expect(page.getByTestId('product-description')).toContainText('ficticio');
    await expect(page.getByTestId('shop-count')).toHaveText(icuPlural(messages.Product.shopCount, 2));
    await expect(page.locator('h2')).toHaveText([
      messages.Product.offersHeading,
      messages.Product.descriptionHeading,
    ]);
    const descriptionFollowsOffers = await page.evaluate(() => {
      const offers = document.querySelector('[data-testid="offer-row"]');
      const description = document.querySelector('[data-testid="product-description"]');
      return Boolean(
        offers && description && offers.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(descriptionFollowsOffers).toBe(true);
    await expect(page.getByText(messages.Product.vatIncluded, { exact: true })).toHaveCount(1);

    await expectLocalScriptsAndLinks(page);
    await close();
  });

  test('has a category breadcrumb, root first, linking to the category pages', async ({ request, browser }) => {
    const response = await request.get(path(DEMO_SHARED.slug));
    const { page, close } = await openRawHtml(browser, await response.text());

    const nav = page.getByTestId('breadcrumb');
    await expect(nav).toHaveCount(1);
    await expect(nav).toHaveAttribute('aria-label', messages.Product.breadcrumbLabel);
    const links = nav.getByRole('link');
    await expect(links).toHaveText([
      DEMO_CATEGORY_NAMES[FIXED_CATEGORY_TREE.slug],
      DEMO_CATEGORY_NAMES[DEMO_SHARED.categorySlug],
    ]);
    await expect(links.nth(0)).toHaveAttribute('href', `/categoria/${FIXED_CATEGORY_TREE.slug}`);
    await expect(links.nth(1)).toHaveAttribute('href', `/categoria/${DEMO_SHARED.categorySlug}`);
    // The product itself is not a crumb.
    await expect(nav).not.toContainText(DEMO_SHARED.title);
    await close();
  });

  test('marks the lowest price Mejor precio on the first row only and repeats it in the hero', async ({
    request,
    browser,
  }) => {
    const response = await request.get(path(DEMO_FOUR_OFFERS.slug));
    const { page, close } = await openRawHtml(browser, await response.text());

    await expect(page.getByTestId('best-price')).toHaveCount(1);
    await expect(page.getByTestId('offer-row').first().getByTestId('best-price')).toHaveText(
      messages.Product.bestPrice,
    );
    await expect(page.getByTestId('offer-row').nth(1).getByTestId('best-price')).toHaveCount(0);

    // The hero price is the cheapest row's price, with the from-label because several shops sell it.
    const prices = await text(page, 'offer-price');
    expect(await text(page, 'product-price')).toEqual([prices[0]]);
    await expect(page.locator('main')).toContainText(messages.Category.priceFrom);
    await expect(page.getByText(messages.Product.vatIncluded, { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('shop-count')).toHaveCount(1);
    await close();
  });

  test('shows no best price and no from-label for a one-shop product, and no brand line or list', async ({
    request,
    browser,
  }) => {
    const response = await request.get(path(DEMO_NO_BRAND.slug));
    const { page, close } = await openRawHtml(browser, await response.text());

    await expect(page.getByTestId('offer-row')).toHaveCount(1);
    await expect(page.getByTestId('best-price')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(messages.Category.priceFrom);
    await expect(page.getByTestId('product-brand')).toHaveCount(0);
    await expect(page.locator('dl')).toHaveCount(0);
    expect(await text(page, 'product-price')).toEqual(await text(page, 'offer-price'));
    await close();
  });

  test('has no Marca term on the shared-EAN product', async ({ request, browser }) => {
    const response = await request.get(path(DEMO_SHARED.slug));
    const { page, close } = await openRawHtml(browser, await response.text());
    await expect(page.locator('dt', { hasText: /^Marca$/ })).toHaveCount(0);
    await close();
  });

  test('lists both shops cheapest first with price, date and the shop count', async ({ request, browser }) => {
    const response = await request.get(path(DEMO_SHARED.slug));
    const { page, close } = await openRawHtml(browser, await response.text());

    await expect(page.getByTestId('offer-row')).toHaveCount(DEMO_SHARED.offers.length);
    expect(await text(page, 'offer-shop')).toEqual(DEMO_SHARED.offers.map((offer) => offer.shopName));
    // 11,49 before 12,99; U+00A0 before the euro sign is normalised.
    expect(await text(page, 'offer-price')).toEqual(['11,49 €', '12,99 €']);
    const datePattern = dateMessagePattern(messages.Product.priceUpdatedOn);
    const updates = await text(page, 'offer-updated');
    expect(updates).toHaveLength(DEMO_SHARED.offers.length);
    for (const updated of updates) {
      expect(updated).toMatch(datePattern);
      expect(updated).toMatch(/^Actualizado el /);
    }
    await close();
  });

  test('lists the four-shop product with four rows, cheapest first, and its category label', async ({
    request,
    browser,
  }) => {
    const response = await request.get(path(DEMO_FOUR_OFFERS.slug));
    expect(response.status()).toBe(200);
    const { page, close } = await openRawHtml(browser, await response.text());

    await expect(page.getByTestId('offer-row')).toHaveCount(DEMO_FOUR_OFFERS.offers.length);
    await expect(page.getByTestId('shop-count')).toHaveText(
      icuPlural(messages.Product.shopCount, DEMO_FOUR_OFFERS.offers.length),
    );
    expect(await text(page, 'offer-shop')).toEqual(DEMO_FOUR_OFFERS.offers.map((offer) => offer.shopName));
    const cents = (await text(page, 'offer-price')).map((value) =>
      Number(value.replace(/[^\d,]/g, '').replace(',', '.')) * 100,
    );
    expect(cents.map(Math.round)).toEqual(DEMO_FOUR_OFFERS.offers.map((offer) => offer.priceCents));
    await expect(page.locator('div[role="img"]')).toHaveAttribute(
      'aria-label',
      messages.Product.imageByCategory[DEMO_FOUR_OFFERS.categorySlug],
    );
    await close();
  });

  test('shows the one-shop wording for a product sold by a single shop', async ({ request, browser }) => {
    const response = await request.get(path(DEMO_NO_BRAND.slug));
    expect(response.status()).toBe(200);
    expectNoSetCookie(response);
    const { page, close } = await openRawHtml(browser, await response.text());

    await expect(page.locator('h1')).toHaveText(DEMO_NO_BRAND.title);
    await expect(page.getByTestId('shop-count')).toHaveText(icuPlural(messages.Product.shopCount, 1));
    await expect(page.getByTestId('offer-row')).toHaveCount(1);
    expect(await text(page, 'offer-price')).toEqual(['6,50 €']);
    await close();
  });

  test('gives every offer one sponsored /go link and leaks no shop host or shipping text', async ({
    request,
    browser,
  }) => {
    const response = await request.get(path(DEMO_SHARED.slug));
    const html = await response.text();

    // The shop URL never reaches the page: the link is our own /go path.
    for (const host of DEMO_SHOP_HOSTS) {
      expect(html).not.toContain(host);
    }
    expect(html).not.toMatch(/env[ií]o/i);

    const { page, close } = await openRawHtml(browser, html);
    const rows = page.getByTestId('offer-row');
    const rowCount = await rows.count();
    expect(rowCount).toBe(DEMO_SHARED.offers.length);

    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      await expect(row.locator('a')).toHaveCount(1);
      const link = row.locator('a[data-testid="offer-go"]');
      await expect(link).toHaveCount(1);
      expect(await link.getAttribute('href')).toMatch(/^\/go\/\d+$/);
      const rel = (await link.getAttribute('rel')) ?? '';
      expect(rel).toContain('sponsored');
      expect(rel).toContain('nofollow');
      expect(await link.getAttribute('target')).toBeNull();
      // No noreferrer or referrerpolicy: /go reads the product page from the Referer.
      expect(rel).not.toContain('noreferrer');
      expect(await link.getAttribute('referrerpolicy')).toBeNull();
      // Short visible text; the shop name is in the accessible name.
      expect((await link.textContent())?.trim()).toBe(messages.Product.goToShopShort);
      await expect(link).toHaveAttribute(
        'aria-label',
        messages.Product.goToShop.replace('{shopName}', DEMO_SHARED.offers[index].shopName),
      );
    }

    // One /go link per row, no other /go link, and no button.
    await expect(page.getByTestId('offer-go')).toHaveCount(rowCount);
    await expect(page.locator('main a[href^="/go/"]')).toHaveCount(rowCount);
    await expect(page.locator('main button')).toHaveCount(0);
    await expect(page.locator('meta[name="referrer"]')).toHaveCount(0);
    await expectLocalScriptsAndLinks(page);
    await close();
  });

  test('a real browser visit sets no cookie, contacts no other origin and requests no /go URL', async ({
    page,
    context,
    baseURL,
  }) => {
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    await page.goto(path(DEMO_SHARED.slug));
    await expect(page.locator('h1')).toHaveText(DEMO_SHARED.title);
    await page.waitForLoadState('networkidle');

    expect(await context.cookies()).toEqual([]);
    expectNoForeignOrigin(requested, new URL(baseURL as string).origin);
    expect(requested.filter((url) => new URL(url).pathname.startsWith('/go/'))).toEqual([]);
  });

  test('an unknown slug returns 404 with the Spanish not-found page and no cookie', async ({
    page,
    context,
  }) => {
    const response = await page.goto(path('no-existe-este-producto'));
    expect(response?.status()).toBe(404);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { name: messages.NotFound.heading })).toBeVisible();
    expect(await context.cookies()).toEqual([]);
  });

  for (const slug of ['Bad_Slug', 'UPPER', 'a--b', 'x'.repeat(130)]) {
    test(`a malformed slug (${slug.slice(0, 12)}) returns the same 404 as an unknown one`, async ({
      request,
    }) => {
      const response = await request.get(path(slug));
      expect(response.status()).toBe(404);
      expectNoSetCookie(response);
      expect(await response.text()).toContain(messages.NotFound.heading);
    });
  }

  test.describe('product JSON-LD (S6.1)', () => {
    const SELECTOR = 'script[type="application/ld+json"][data-testid="product-jsonld"]';
    const scripts = (html: string) =>
      [...html.matchAll(/<script[^>]* type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(
        (match) => match[1],
      );

    test('the shared-EAN page has exactly one parseable product-jsonld script matching the offer list', async ({
      request,
      browser,
    }) => {
      const response = await request.get(path(DEMO_SHARED.slug));
      expectNoSetCookie(response);
      const html = await response.text();
      expect(scripts(html)).toHaveLength(1);

      const { page, close } = await openRawHtml(browser, html);
      await expect(page.locator(SELECTOR)).toHaveCount(1);
      const json = JSON.parse((await page.locator(SELECTOR).textContent()) ?? '');

      expect(json).toMatchObject({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: DEMO_SHARED.title,
        brand: { '@type': 'Brand', name: DEMO_SHARED.brand },
        mpn: DEMO_SHARED.partNumber,
        gtin: DEMO_SHARED.ean,
      });

      // The JSON-LD agrees with the visible list on the same page.
      const visible = (await text(page, 'offer-price')).map((price) =>
        price.replace(/[^\d,]/g, '').replace(',', '.'),
      );
      expect(json.offers['@type']).toBe('AggregateOffer');
      expect(json.offers.priceCurrency).toBe('EUR');
      expect(json.offers.offerCount).toBe(await page.getByTestId('offer-row').count());
      expect(json.offers.lowPrice).toBe(visible[0]);
      expect(json.offers.highPrice).toBe(visible[visible.length - 1]);
      expect(json.offers.lowPrice).toBe('11.49');
      expect(json.offers.highPrice).toBe('12.99');
      expect(typeof json.offers.lowPrice).toBe('string');

      // No scripts with a source, no shop host: the tag carries no link out.
      expect(JSON.stringify(json)).not.toContain('/go/');
      for (const host of DEMO_SHOP_HOSTS) expect(JSON.stringify(json)).not.toContain(host);
      await close();
    });

    test('a single-shop product has equal low and high prices', async ({ request }) => {
      const html = await (await request.get(path(DEMO_NO_BRAND.slug))).text();
      const found = scripts(html);
      expect(found).toHaveLength(1);
      const json = JSON.parse(found[0]);
      expect(json.name).toBe(DEMO_NO_BRAND.title);
      expect(json.offers).toMatchObject({
        lowPrice: '6.50',
        highPrice: '6.50',
        offerCount: 1,
        priceCurrency: 'EUR',
      });
    });

    test('the 404 page carries no JSON-LD', async ({ request }) => {
      const response = await request.get(path('no-existe-este-producto'));
      expect(response.status()).toBe(404);
      expect(scripts(await response.text())).toHaveLength(0);
    });
  });
});
