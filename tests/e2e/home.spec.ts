import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
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

test.describe('home page (C-7)', () => {
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

    // Parse the raw server HTML in a context with JavaScript off.
    const { page, close } = await openRawHtml(browser, await response.text());

    await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(siteName);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.getByTestId('home-panel').locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('home-panel').locator('p')).toHaveText(messages.Home.tagline);
    // The tagline is the only paragraph: names and counts are spans inside links.
    await expect(page.locator('p')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(messages.Home.categoriesHeading);
    await expect(page.getByTestId('category-tree')).toHaveCount(1);
    await expect(page.getByTestId('category-empty')).toHaveCount(0);
    expect(await page.title()).toContain(siteName);

    // No third-party script or off-site link.
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
    await expect(page.locator('h1')).toHaveText(siteName);
    await page.waitForLoadState('networkidle');

    expect(await context.cookies()).toEqual([]);
    expectNoForeignOrigin(requested, new URL(baseURL as string).origin);
  });

  test('lists the demo tree in position order, with counts and links to category pages', async ({
    request,
    browser,
  }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const { page, close } = await openRawHtml(browser, await response.text());

    const groups = page.getByTestId('category-group');
    await expect(groups).toHaveCount(2);
    const first = groups.nth(0);
    const second = groups.nth(1);
    await expect(first.getByTestId('category-group-link')).toHaveAttribute('href', '/categoria/automovil');
    await expect(first.getByTestId('category-group-link')).toContainText(DEMO_CATEGORY_NAMES.automovil);
    await expect(first.getByTestId('category-group-count')).toHaveText(
      icuPlural(messages.Home.productCount, DEMO_CATEGORY_COUNTS.automovil),
    );
    await expect(second.getByTestId('category-group-link')).toHaveAttribute(
      'href',
      '/categoria/herramientas',
    );
    await expect(second.getByTestId('category-group-count')).toHaveText(
      icuPlural(messages.Home.productCount, DEMO_CATEGORY_COUNTS.herramientas),
    );

    // Filtros comes before Escobillas y bombillas; both are rows of Automóvil.
    const rows = first.getByTestId('category-row-link');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('href', '/categoria/filtros');
    await expect(rows.nth(0)).toContainText(DEMO_CATEGORY_NAMES.filtros);
    await expect(rows.nth(1)).toHaveAttribute('href', '/categoria/escobillas-y-bombillas');
    await expect(rows.nth(1)).toContainText(DEMO_CATEGORY_NAMES['escobillas-y-bombillas']);
    await expect(first.getByTestId('category-row-count').nth(0)).toHaveText(
      icuPlural(messages.Home.productCount, DEMO_CATEGORY_COUNTS.filtros),
    );
    await expect(first.getByTestId('category-row-count').nth(1)).toHaveText(
      icuPlural(messages.Home.productCount, 1),
    );

    // Never a zero count.
    expect(await page.getByTestId('category-tree').textContent()).not.toMatch(/0 producto/);
    await expectLocalScriptsAndLinks(page);
    await close();
  });

  test('leaves out an empty demo category that still answers 200 at its own page', async ({
    request,
    page,
  }) => {
    const slug = 'aceites-y-lubricantes';
    expect(DEMO_CATEGORY_COUNTS[slug]).toBe(0);

    const home = await request.get('/');
    const html = await home.text();
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
      '[data-testid="category-group-link"], [data-testid="category-row-link"]',
    );
    const entries = await links.evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.getAttribute('href') ?? '',
        count: node.querySelector('span:last-child')?.textContent ?? '',
      })),
    );
    expect(entries.length).toBeGreaterThanOrEqual(4);

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
