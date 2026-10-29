import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_NO_BRAND, DEMO_SHARED } from '../fixtures/demo';
import { loadEnv } from '../support/env';
import { icuPlural, normaliseSpaces } from '../support/messages';
import {
  expectNoForeignOrigin,
  expectNoSetCookie,
  expectServerRenderedNotFound,
  openRawHtml,
  stripScripts,
} from '../support/page-checks';

// S5.4 (US-5.4, ACs 18 to 37) against the Compose stack, demo data after one import. The header
// search box (T5.4.5) is a later order and is not covered here. The privacy proof (ACs 31 and 32)
// is in search-privacy.spec.ts; the 195 and 360 px reflow is in reflow.spec.ts.
//
// Demo facts used: the word "filtro" matches more than one page of public products (24 per page);
// DEMO_SHARED is found by its EAN and part number. No exact product counts are pinned: the count
// shown is compared with the cards actually listed.

loadEnv();
const siteName = (process.env.SITE_NAME ?? '').trim();

const PAGE_SIZE = 24;
const MANY = 'filtro';
const NOTHING = 'zqxvbnmw';

const url = (term: string, page?: number) =>
  `/buscar?q=${encodeURIComponent(term)}${page === undefined ? '' : `&pagina=${page}`}`;

async function html(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  expectNoSetCookie(response);
  return response.text();
}

/** Opens the server HTML of a path with JavaScript off. */
async function raw(browser: Browser, request: APIRequestContext, path: string) {
  return openRawHtml(browser, await html(request, path));
}

const productHref = (slug: string) => `/producto/${slug}`;

test.describe('search results page (S5.4)', () => {
  test('SITE_NAME is configured for the run', () => {
    expect(siteName).not.toBe('');
  });

  test('AC 18, 20: answers 200 with the cards in the HTML, no script needed', async ({ request, browser }) => {
    const response = await request.get(url(MANY));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expectNoSetCookie(response);
    const body = stripScripts(await response.text());
    expect((body.match(/data-testid="category-card"/g) ?? []).length).toBe(PAGE_SIZE);

    const { page, close } = await openRawHtml(browser, await response.text());
    await expect(page.getByTestId('category-card')).toHaveCount(PAGE_SIZE);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(messages.Search.heading);
    const first = page.getByTestId('category-card').first();
    await expect(first.getByTestId('card-title')).toHaveAttribute('href', /^\/producto\/.+/);
    await expect(first.getByTestId('card-price')).toContainText('€');
    await expect(first.getByTestId('card-shop-count')).toBeVisible();
    await close();
  });

  test('AC 19, 21: the count equals the cards over all pages and names the term; the page line is shown', async ({
    request,
    browser,
  }) => {
    const first = await raw(browser, request, url(MANY));
    const summary = normaliseSpaces((await first.page.getByTestId('search-summary').textContent()) ?? '');
    const match = /^(\d+) productos para «filtro» · Página 1 de (\d+)$/.exec(summary.trim());
    expect(match, summary).not.toBeNull();
    const count = Number(match![1]);
    const pages = Number(match![2]);
    expect(pages).toBe(Math.ceil(count / PAGE_SIZE));
    expect(pages).toBeGreaterThan(1);
    await expect(first.page.getByTestId('pagination-indicator')).toHaveText(
      messages.Category.pageIndicator.replace('{page}', '1').replace('{pages}', String(pages)),
    );
    await first.close();

    let listed = 0;
    for (let index = 1; index <= pages; index += 1) {
      const view = await raw(browser, request, url(MANY, index));
      listed += await view.page.getByTestId('category-card').count();
      await view.close();
    }
    expect(listed).toBe(count);
  });

  test('AC 21: page links keep the term; page 1 has no previous link, the last page no next link', async ({
    request,
    browser,
  }) => {
    const first = await raw(browser, request, url(MANY));
    await expect(first.page.getByTestId('pagination-prev')).toHaveCount(0);
    await expect(first.page.getByTestId('pagination-next')).toHaveAttribute('href', url(MANY, 2));
    await expect(first.page.getByTestId('pagination-next')).toContainText(messages.Category.nextPage);
    await first.close();

    const last = await raw(browser, request, url(MANY, 2));
    await expect(last.page.getByTestId('pagination-next')).toHaveCount(0);
    await expect(last.page.getByTestId('pagination-prev')).toHaveAttribute('href', url(MANY));
    await expect(last.page.getByTestId('pagination-prev')).toContainText(messages.Category.previousPage);
    await expect(last.page.getByTestId('search-input')).toHaveValue(MANY);
    await last.close();
  });

  test('AC 21: a single page of results shows no pagination', async ({ request, browser }) => {
    const { page, close } = await raw(browser, request, url(DEMO_SHARED.ean));
    await expect(page.getByTestId('category-card')).toHaveCount(1);
    await expect(page.getByTestId('pagination')).toHaveCount(0);
    expect(normaliseSpaces((await page.getByTestId('search-summary').textContent()) ?? '')).not.toMatch(
      /Página \d/,
    );
    const tail = messages.Search.summary.replace(/^\{.*?\}\}/, '').replace('{term}', DEMO_SHARED.ean);
    await expect(page.getByTestId('search-summary')).toHaveText(`${icuPlural(messages.Search.summary, 1)}${tail}`);
    await close();
  });

  test('AC 22: a page value below 1 or not a number shows page 1', async ({ request, browser }) => {
    for (const value of ['0', '-3', 'abc', '']) {
      const { page, close } = await raw(browser, request, `${url(MANY)}&pagina=${value}`);
      await expect(page.getByTestId('category-card'), value).toHaveCount(PAGE_SIZE);
      await expect(page.getByTestId('pagination-prev'), value).toHaveCount(0);
      await expect(page.getByTestId('pagination-next'), value).toHaveCount(1);
      await close();
    }
  });

  test('AC 22: a page past the last, or page 2 of an empty search, is the full not-found page with a 404', async ({
    request,
  }) => {
    for (const path of [url(MANY, 99), url(NOTHING, 2)]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expectNoSetCookie(response);
      expectServerRenderedNotFound(await response.text(), siteName, path);
    }
  });

  test('AC 20, 7, 8: a card shows title, brand, price in EUR, shop count and a link; the EAN match is listed once', async ({
    request,
    browser,
  }) => {
    const { page, close } = await raw(browser, request, url(DEMO_SHARED.ean));
    const card = page.getByTestId('category-card');
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('card-title')).toHaveText(DEMO_SHARED.title);
    await expect(card.getByTestId('card-title')).toHaveAttribute('href', productHref(DEMO_SHARED.slug));
    await expect(card.getByTestId('card-brand')).toHaveText(DEMO_SHARED.brand);
    expect(normaliseSpaces((await card.getByTestId('card-price').textContent()) ?? '').trim()).toBe('11,49 €');
    await expect(card.getByTestId('card-price-from')).toHaveText(messages.Category.priceFrom);
    await expect(card.getByTestId('card-shop-count')).toHaveText(icuPlural(messages.Product.shopCount, 2));
    await close();
  });

  test('AC 20: a product with no brand renders without a brand and without a placeholder', async ({
    request,
    browser,
  }) => {
    const { page, close } = await raw(browser, request, url(DEMO_NO_BRAND.title));
    const card = page.locator('[data-testid="category-card"]', {
      has: page.locator(`a[href="${productHref(DEMO_NO_BRAND.slug)}"]`),
    });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('card-brand')).toHaveCount(0);
    const text = (await card.textContent()) ?? '';
    expect(text).not.toMatch(/null|undefined|NaN/);
    await close();
  });

  test('AC 17: a list of demo-only products shows the demo notice once; an empty state shows none', async ({
    request,
    browser,
  }) => {
    const results = await raw(browser, request, url(MANY));
    await expect(results.page.locator('main p[role="note"]')).toHaveCount(1);
    await expect(results.page.locator('main p[role="note"]')).toHaveText(messages.DemoNotice.body);
    await results.close();

    const empty = await raw(browser, request, url(NOTHING));
    await expect(empty.page.locator('main p[role="note"]')).toHaveCount(0);
    await empty.close();
  });
});

test.describe('search matching through the real stack (S5.4)', () => {
  const SHARED_FIRST = async (browser: Browser, request: APIRequestContext, term: string) => {
    const { page, close } = await raw(browser, request, url(term));
    const titles = page.getByTestId('card-title');
    await expect(titles.first(), term).toHaveAttribute('href', productHref(DEMO_SHARED.slug));
    // listed once, whatever routes matched it
    await expect(page.locator(`a[href="${productHref(DEMO_SHARED.slug)}"]`), term).toHaveCount(1);
    await close();
  };

  for (const term of ['2000000000015', '2 000000 000015', '2-000000000015', '2.000000.000015']) {
    test(`AC 5: the EAN spelled "${term}" finds the product`, async ({ request, browser }) => {
      await SHARED_FIRST(browser, request, term);
    });
  }

  for (const term of ['oc-12.34', 'OC 1234', 'oc1234']) {
    test(`AC 6: the part number spelled "${term}" finds the product, first`, async ({ request, browser }) => {
      await SHARED_FIRST(browser, request, term);
    });
  }

  test('AC 5, 6: a number that is no product EAN or part number finds nothing', async ({ request, browser }) => {
    for (const term of ['2000000000998', 'oc123']) {
      const { page, close } = await raw(browser, request, url(term));
      await expect(page.getByTestId('category-card'), term).toHaveCount(0);
      await expect(page.getByTestId('category-empty').locator('h2'), term).toHaveText(
        messages.Search.noResultsHeading,
      );
      await close();
    }
  });

  test('AC 1, 2: words of the title and the brand match, ignoring case and accents', async ({ request, browser }) => {
    for (const term of ['marcademo 1234', 'MARCADEMO  Aceite', 'filtró aceite 1234']) {
      const { page, close } = await raw(browser, request, url(term));
      await expect(page.locator(`a[href="${productHref(DEMO_SHARED.slug)}"]`), term).toHaveCount(1);
      await close();
    }
  });

  test('AC 3: the plural of a title word matches', async ({ request, browser }) => {
    const { page, close } = await raw(browser, request, url('filtros aceite 1234'));
    await expect(page.locator(`a[href="${productHref(DEMO_SHARED.slug)}"]`)).toHaveCount(1);
    await close();
  });

  test('AC 4: a viscosity code matches in three spellings', async ({ request, browser }) => {
    for (const term of ['5W-30', '5w30', '5W 30']) {
      const { page, close } = await raw(browser, request, url(term));
      await expect(page.locator(`a[href="${productHref(DEMO_NO_BRAND.slug)}"]`), term).toHaveCount(1);
      await close();
    }
  });

  test('AC 10: the first of several q values is used; whitespace is trimmed; 100 characters at most', async ({
    request,
    browser,
  }) => {
    const several = await raw(browser, request, `/buscar?q=${MANY}&q=${NOTHING}`);
    await expect(several.page.getByTestId('search-input')).toHaveValue(MANY);
    await several.close();

    const padded = await raw(browser, request, `/buscar?q=%20%20${MANY}%20%20`);
    await expect(padded.page.getByTestId('search-input')).toHaveValue(MANY);
    await padded.close();

    const long = await raw(browser, request, `/buscar?q=${'a'.repeat(130)}`);
    await expect(long.page.getByTestId('search-input')).toHaveValue('a'.repeat(100));
    await long.close();
  });

  const HOSTILE = [
    ['percent', '%25'],
    ['underscore', '_'],
    ['double quote', '%22'],
    ['single quote', "'"],
    ['backslash', '%5C'],
    ['ampersand', '%26'],
    ['pipe', '%7C'],
    ['bang', '!'],
    ['colon', '%3A'],
    ['open parenthesis', '('],
    ['punctuation', '...---'],
    ['emoji', '%F0%9F%94%A5'],
    ['encoded NUL', '%00'],
    ['percent with letters', '%25ilt'],
  ] as const;

  for (const [name, encoded] of HOSTILE) {
    test(`AC 11: ${name} answers 200 and matches nothing`, async ({ request, browser }) => {
      const { page, close } = await raw(browser, request, `/buscar?q=${encoded}`);
      await expect(page.getByTestId('category-card')).toHaveCount(0);
      await expect(page.getByTestId('search-summary')).toHaveCount(0);
      await expect(page.getByTestId('category-empty')).toHaveCount(1);
      await close();
    });
  }
});

test.describe('search empty states (S5.4)', () => {
  for (const path of ['/buscar', '/buscar?q=', '/buscar?q=%20%20']) {
    test(`AC 23: ${path} shows the prompt, an empty field, no list and no "no results"`, async ({
      request,
      browser,
    }) => {
      const { page, close } = await raw(browser, request, path);
      await expect(page.getByTestId('search-input')).toHaveValue('');
      await expect(page.getByTestId('category-empty').locator('h2')).toHaveText(messages.Search.promptHeading);
      await expect(page.getByTestId('category-empty')).toContainText(messages.Search.promptBody);
      await expect(page.getByTestId('category-card')).toHaveCount(0);
      await expect(page.getByTestId('search-summary')).toHaveCount(0);
      await expect(page.getByText(messages.Search.noResultsHeading)).toHaveCount(0);
      await close();
    });
  }

  test('AC 23: a page number on an empty query is ignored', async ({ request, browser }) => {
    const { page, close } = await raw(browser, request, '/buscar?pagina=3');
    await expect(page.getByTestId('category-empty').locator('h2')).toHaveText(messages.Search.promptHeading);
    await close();
  });

  test('AC 24: no results names the term, keeps it in the field, offers a way out and shows no count', async ({
    request,
    browser,
  }) => {
    const { page, close } = await raw(browser, request, url(NOTHING));
    const empty = page.getByTestId('category-empty');
    await expect(empty.locator('h2')).toHaveText(messages.Search.noResultsHeading);
    await expect(empty).toContainText(messages.Search.noResultsBody.replace('{term}', NOTHING));
    await expect(page.getByTestId('search-input')).toHaveValue(NOTHING);
    await expect(page.getByTestId('category-empty-action')).toHaveAttribute('href', '/');
    await expect(page.getByTestId('category-empty-action')).toHaveText(messages.Search.browseAction);
    await expect(page.getByTestId('search-summary')).toHaveCount(0);
    await expect(page.getByTestId('category-card')).toHaveCount(0);
    await close();
  });

  test('AC 19: markup typed into the field is shown as typed, never interpreted', async ({ request, browser }) => {
    const term = `<b>${NOTHING}</b>`;
    const response = await request.get(url(term));
    expect(response.status()).toBe(200);
    const markup = stripScripts(await response.text());
    expect(markup).not.toContain(`<b>${NOTHING}`);
    const { page, close } = await openRawHtml(browser, await response.text());
    await expect(page.locator('main b')).toHaveCount(0);
    await expect(page.getByTestId('search-input')).toHaveValue(term);
    await expect(page.getByTestId('category-empty')).toContainText(term);
    await close();
  });
});

test.describe('search form and metadata (S5.4)', () => {
  test('AC 25, 30, 37: the page form is a labelled GET form to /buscar holding the term, 100 characters at most', async ({
    request,
    browser,
  }) => {
    const { page, close } = await raw(browser, request, url(MANY));
    const form = page.getByTestId('search-form');
    await expect(form).toHaveAttribute('role', 'search');
    await expect(form).toHaveAttribute('method', 'get');
    await expect(form).toHaveAttribute('action', '/buscar');
    const input = page.getByTestId('search-input');
    await expect(input).toHaveAttribute('name', 'q');
    await expect(input).toHaveAttribute('maxlength', '100');
    await expect(input).not.toHaveAttribute('placeholder', /.*/);
    await expect(input).toHaveValue(MANY);
    await expect(form.getByLabel(messages.Search.fieldLabel)).toHaveCount(1);
    await expect(page.getByTestId('search-button')).toHaveText(messages.Search.button);
    await expect(form.getByText(messages.Search.hint)).toHaveCount(1);
    await close();
  });

  test('AC 37: the home field keeps its 100-character limit and its label', async ({ request, browser }) => {
    const { page, close } = await openRawHtml(browser, await html(request, '/'));
    await expect(page.getByTestId('home-search-input')).toHaveAttribute('maxlength', '100');
    await expect(page.getByTestId('home-search').getByLabel(messages.Home.searchLabel)).toHaveCount(1);
    await close();
  });

  for (const [name, path] of [
    ['results', url(MANY)],
    ['page 2', url(MANY, 2)],
    ['empty query', '/buscar'],
    ['no results', url(NOTHING)],
    ['hostile term', '/buscar?q=%25'],
  ] as const) {
    test(`AC 28, 33: ${name} is noindex with no canonical, sets no cookie and sends Referrer-Policy same-origin`, async ({
      request,
      browser,
    }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expectNoSetCookie(response);
      expect(response.headers()['referrer-policy']).toBe('same-origin');
      const { page, close } = await openRawHtml(browser, await response.text());
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await close();
    });
  }

  test('AC 28: the not-found page of a past-last search carries the referrer policy and no cookie', async ({
    request,
  }) => {
    const response = await request.get(url(MANY, 99));
    expect(response.status()).toBe(404);
    expectNoSetCookie(response);
    expect(response.headers()['referrer-policy']).toBe('same-origin');
  });

  test('AC 29: robots.txt still disallows /buscar and no sitemap file lists it', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots.split(/\r?\n/)).toContain('Disallow: /buscar');

    const index = await (await request.get('/sitemap.xml')).text();
    expect(index).not.toContain('/buscar');
    const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      const body = await (await request.get(new URL(loc).pathname)).text();
      expect(body, loc).not.toContain('/buscar');
    }
  });

  test('AC 33: a browser visit sets no cookie, writes no storage and contacts no other origin', async ({
    page,
    context,
    baseURL,
  }) => {
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    for (const path of [url(MANY), '/buscar', url(NOTHING)]) {
      await page.goto(path);
      await expect(page.getByTestId('search-form')).toBeVisible();
      await page.waitForLoadState('networkidle');
    }

    expect(await context.cookies()).toEqual([]);
    const storage = await page.evaluate(async () => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
      databases: 'databases' in indexedDB ? (await indexedDB.databases()).length : 0,
    }));
    expect(storage).toEqual({ local: 0, session: 0, databases: 0 });
    expectNoForeignOrigin(requested, new URL(baseURL as string).origin);
  });
});

test.describe('search flows in a browser (S5.4)', () => {
  test('AC 34: the home form leads to the results, and a card leads to the product page', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await page.getByTestId('home-search-input').fill(DEMO_SHARED.partNumber);
    await page.getByTestId('home-search-button').click();
    await expect(page).toHaveURL(/\/buscar\?q=OC\+1234$|\/buscar\?q=OC%201234$/);
    await expect(page.getByTestId('search-input')).toHaveValue(DEMO_SHARED.partNumber);

    await page.getByTestId('card-title').first().click();
    await expect(page).toHaveURL(new RegExp(`${productHref(DEMO_SHARED.slug)}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_SHARED.title);
    expect(await context.cookies()).toEqual([]);
  });

  test('AC 25: editing the term in the page form and submitting loads the new term', async ({ page }) => {
    await page.goto(url(NOTHING));
    await page.getByTestId('search-input').fill(DEMO_SHARED.ean);
    await page.getByTestId('search-button').click();
    await expect(page).toHaveURL(new RegExp(`/buscar\\?q=${DEMO_SHARED.ean}$`));
    await expect(page.getByTestId('category-card')).toHaveCount(1);
  });

  test('AC 30: with JavaScript off a visitor can search, page and go back', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto('/buscar');
    await page.getByTestId('search-input').fill(MANY);
    await page.getByTestId('search-button').click();
    await expect(page).toHaveURL(new RegExp(`/buscar\\?q=${MANY}$`));
    await expect(page.getByTestId('category-card')).toHaveCount(PAGE_SIZE);

    await page.getByTestId('pagination-next').click();
    await expect(page).toHaveURL(new RegExp(`/buscar\\?q=${MANY}&pagina=2$`));
    await expect(page.getByTestId('search-input')).toHaveValue(MANY);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/buscar\\?q=${MANY}$`));
    await expect(page.getByTestId('category-card')).toHaveCount(PAGE_SIZE);
    expect(await context.cookies()).toEqual([]);
    await context.close();
  });
});

for (const [width, height] of [
  [360, 740],
  [195, 422],
] as const) {
  test.describe(`search form at ${width}x${height} (AC 27)`, () => {
    test.use({ viewport: { width, height } });

    test('the field and the button stay inside the viewport and can be used', async ({ page }) => {
      await page.goto(url(MANY));
      for (const id of ['search-input', 'search-button']) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box, id).not.toBeNull();
        expect(box!.x, id).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, id).toBeLessThanOrEqual(width);
        expect(box!.height, id).toBeGreaterThanOrEqual(44);
      }
      await page.getByTestId('search-input').fill(DEMO_SHARED.ean);
      await page.getByTestId('search-button').click();
      await expect(page).toHaveURL(new RegExp(`/buscar\\?q=${DEMO_SHARED.ean}$`));
    });
  });
}
