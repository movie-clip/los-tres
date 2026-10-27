import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import { DEMO_CATEGORY_COUNTS, DEMO_CATEGORY_NAMES } from '../fixtures/demo';
import { loadEnv } from '../support/env';
import { icuPlural } from '../support/messages';
import {
  expectLocalScriptsAndLinks,
  expectNoForeignOrigin,
  expectNoSetCookie,
  openRawHtml,
} from '../support/page-checks';

loadEnv();
const siteName = (process.env.SITE_NAME ?? '').trim();

const ROOT = FIXED_CATEGORY_TREE.slug;
// Demo state: the populated children in position order (the fuel child is empty and has no tile).
const populated = FIXED_CATEGORY_TREE.children.filter(
  (child) => DEMO_CATEGORY_COUNTS[child.slug as keyof typeof DEMO_CATEGORY_COUNTS] > 0,
);

test.describe('home page (C-7, S11.3)', () => {
  test('SITE_NAME is configured for the run', () => {
    expect(siteName).not.toBe('');
  });

  test('server-renders the contract without JavaScript and without a cookie', async ({
    request,
    browser,
  }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expectNoSetCookie(response);

    const { page, close } = await openRawHtml(browser, await response.text());

    await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(messages.Home.heading);
    await expect(page.locator('main')).toHaveCount(1);
    const panel = page.getByTestId('home-panel');
    await expect(panel.locator('h1')).toHaveCount(1);
    await expect(panel.getByText(messages.Home.tagline)).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      messages.Home.categoriesHeading,
    );
    await expect(page.getByTestId('category-tiles')).toHaveCount(1);
    await expect(page.getByTestId('category-empty')).toHaveCount(0);
    await expect(page.getByTestId('home-search')).toHaveCount(1);
    // No search notice without a query.
    await expect(page.getByTestId('home-search-notice')).toHaveCount(0);
    expect(await page.title()).toContain(siteName);

    await expectLocalScriptsAndLinks(page);
    await close();
  });

  test('sets no cookie and contacts no other origin in a real browser visit', async ({
    page,
    context,
    baseURL,
  }) => {
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    await page.goto('/');
    await expect(page.locator('h1')).toHaveText(messages.Home.heading);
    await page.waitForLoadState('networkidle');

    expect(await context.cookies()).toEqual([]);
    expectNoForeignOrigin(requested, new URL(baseURL as string).origin);
  });

  test('shows four tiles in position order, each with its drawing, link and count (demo state)', async ({
    request,
    browser,
  }) => {
    // The demo data fills four of the five fixed children: the fuel child is empty.
    expect(populated).toHaveLength(4);
    expect(FIXED_CATEGORY_TREE.children).toHaveLength(5);

    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const { page, close } = await openRawHtml(browser, await response.text());

    const tiles = page.getByTestId('category-tile');
    await expect(tiles).toHaveCount(4);
    for (const [index, child] of populated.entries()) {
      const tile = tiles.nth(index);
      await expect(tile.getByTestId('category-tile-link')).toHaveAttribute(
        'href',
        `/categoria/${child.slug}`,
      );
      await expect(tile.getByTestId('category-tile-name')).toHaveText(child.name);
      await expect(tile.getByTestId('category-tile-count')).toHaveText(
        icuPlural(
          messages.Home.productCount,
          DEMO_CATEGORY_COUNTS[child.slug as keyof typeof DEMO_CATEGORY_COUNTS],
        ),
      );
      await expect(tile.getByTestId('category-illustration')).toHaveCount(1);
    }

    // Never a zero count.
    expect(await page.getByTestId('category-tiles').textContent()).not.toMatch(/(^|\D)0 producto/);
    expect(await page.locator('main').textContent()).not.toMatch(/(^|\D)0 producto/);
    await expectLocalScriptsAndLinks(page);
    await close();
  });

  test('links to the whole catalogue and shows no group card for the root', async ({
    request,
    browser,
  }) => {
    const { page, close } = await openRawHtml(browser, await (await request.get('/')).text());

    const all = page.getByTestId('home-all-link');
    await expect(all).toHaveCount(1);
    await expect(all).toHaveAttribute('href', `/categoria/${ROOT}`);
    await expect(all).toContainText(messages.Home.allLink);
    await expect(page.getByTestId('home-all-count')).toHaveText(
      icuPlural(messages.Home.productCount, DEMO_CATEGORY_COUNTS[ROOT as keyof typeof DEMO_CATEGORY_COUNTS]),
    );
    await expect(page.getByRole('heading', { name: DEMO_CATEGORY_NAMES[ROOT as keyof typeof DEMO_CATEGORY_NAMES] })).toHaveCount(0);
    await close();
  });

  test('names car maintenance on the home page, not tools or spare parts', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect(html).toContain(messages.Home.tagline);
    expect(html.toLowerCase()).not.toContain('herramientas');
    expect(html.toLowerCase()).not.toContain('recambios');
  });

  test('leaves out the empty fixed category that still answers 200 at its own page', async ({
    request,
    page,
  }) => {
    const slug = 'filtros-de-combustible';
    expect(DEMO_CATEGORY_COUNTS[slug]).toBe(0);

    const html = await (await request.get('/')).text();
    expect(html).not.toContain(`/categoria/${slug}`);
    expect(html).not.toContain(DEMO_CATEGORY_NAMES[slug]);

    const response = await request.get(`/categoria/${slug}`);
    expect(response.status()).toBe(200);
    await page.goto(`/categoria/${slug}`);
    await expect(page.getByTestId('category-empty')).toHaveCount(1);
  });

  test('every home link opens a category page showing the home count (invariant I-1)', async ({
    page,
  }) => {
    await page.goto('/');
    const links = page.locator(
      '[data-testid="category-tile-link"], [data-testid="home-all-link"]',
    );
    const entries = await links.evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.getAttribute('href') ?? '',
        count: node.querySelector('span:last-child')?.textContent ?? '',
      })),
    );
    expect(entries).toHaveLength(populated.length + 1);

    for (const { href, count } of entries) {
      expect(href).toMatch(/^\/categoria\/[a-z0-9-]+$/);
      const number = Number(count.replace(/\D/g, ''));
      expect(number).toBeGreaterThanOrEqual(1);
      await page.goto(href);
      await expect(page.getByTestId('category-empty'), href).toHaveCount(0);
      await expect(page.getByTestId('category-summary'), href).toContainText(
        icuPlural(messages.Category.summary, number),
      );
    }
  });

  test('the header site name is a link to / at least 44 px tall', async ({ page }) => {
    await page.goto('/');
    const link = page.getByTestId('site-header-link');
    await expect(link).toHaveText(siteName);
    await expect(link).toHaveAttribute('href', '/');
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe('home search form and interim notice (S11.3)', () => {
  test('is a GET form to / with a labelled q field, no value and no placeholder', async ({
    request,
    browser,
  }) => {
    const { page, close } = await openRawHtml(browser, await (await request.get('/')).text());

    const form = page.getByTestId('home-search');
    await expect(form).toHaveAttribute('role', 'search');
    await expect(form).toHaveAttribute('method', 'get');
    await expect(form).toHaveAttribute('action', '/');
    const input = page.getByTestId('home-search-input');
    await expect(input).toHaveAttribute('name', 'q');
    await expect(input).toHaveValue('');
    await expect(input).not.toHaveAttribute('placeholder', /.*/);
    await expect(page.getByLabel(messages.Home.searchLabel)).toHaveCount(1);
    await expect(page.getByTestId('home-search-button')).toHaveText(messages.Home.searchButton);
    await close();
  });

  for (const query of ['?q=filtro', '?q=', '?q=a&q=b']) {
    test(`${query} shows the notice, an empty field and the tiles unchanged (JavaScript off)`, async ({
      request,
      browser,
    }) => {
      const response = await request.get(`/${query}`);
      expect(response.status()).toBe(200);
      expectNoSetCookie(response);
      const { page, close } = await openRawHtml(browser, await response.text());

      await expect(page.getByTestId('home-search-notice')).toHaveText(messages.Home.searchNotice);
      await expect(page.getByTestId('home-search-notice')).toHaveAttribute('role', 'status');
      await expect(page.getByTestId('home-search-input')).toHaveValue('');
      await expect(page.getByTestId('category-tile')).toHaveCount(populated.length);
      await close();
    });
  }

  test('the typed q never appears in the rendered markup, even HTML-significant text', async ({
    request,
  }) => {
    // Next itself writes the request URL into the inline flight scripts (router state), so the
    // check covers the markup outside <script>: text, attributes, title, meta and links.
    const token = 'zqxjv7431';
    for (const q of [token, `<b>${token}</b>`, `"${token}"`]) {
      const response = await request.get('/', { params: { q } });
      expect(response.status()).toBe(200);
      const markup = (await response.text()).replace(/<script\b[\s\S]*?<\/script>/g, '');
      expect(markup, q).toContain('data-testid="home-search-notice"');
      expect(markup, q).not.toContain(token);
    }
  });

  test('a browser submit lands on /?q=... with the notice and an empty field, no cookie', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await page.getByTestId('home-search-input').fill('filtro');
    await page.getByTestId('home-search-button').click();
    await expect(page).toHaveURL(/\/\?q=filtro$/);
    await expect(page.getByTestId('home-search-notice')).toHaveText(messages.Home.searchNotice);
    await expect(page.getByTestId('home-search-input')).toHaveValue('');
    expect(await context.cookies()).toEqual([]);
  });

  test('the canonical of /?q=... is the plain home', async ({ request, baseURL }) => {
    const html = await (await request.get('/?q=filtro')).text();
    const match = html.match(/<link rel="canonical" href="([^"]*)"/);
    // SITE_URL may be unset (then there is no canonical); when set, no query survives.
    if (match) {
      expect(match[1]).not.toContain('q=');
      expect(new URL(match[1], baseURL).pathname).toBe('/');
    }
  });
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test.describe(`home layout at ${viewport.name} width (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('does not scroll sideways, with and without the notice', async ({ page }) => {
      for (const url of ['/', '/?q=filtro']) {
        await page.goto(url);
        await page.getByTestId('category-tile').first().waitFor();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, url).toBeLessThanOrEqual(0);
      }
    });

    test('keeps the field and button on one row and the tiles inside the viewport', async ({
      page,
    }) => {
      await page.goto('/');
      const input = await page.getByTestId('home-search-input').boundingBox();
      const button = await page.getByTestId('home-search-button').boundingBox();
      expect(input).not.toBeNull();
      expect(button).not.toBeNull();
      expect(Math.abs(input!.y - button!.y)).toBeLessThanOrEqual(1);
      expect(button!.x).toBeGreaterThan(input!.x);

      const tiles = page.getByTestId('category-tile');
      const count = await tiles.count();
      for (let index = 0; index < count; index += 1) {
        const box = await tiles.nth(index).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      }
    });
  });
}
