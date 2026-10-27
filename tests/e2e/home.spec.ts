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

  test('lists the fixed tree: one root with its populated children in position order', async ({
    request,
    browser,
  }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const { page, close } = await openRawHtml(browser, await response.text());

    const groups = page.getByTestId('category-group');
    await expect(groups).toHaveCount(1);
    const group = groups.nth(0);
    await expect(group.getByTestId('category-group-link')).toHaveAttribute(
      'href',
      `/categoria/${FIXED_CATEGORY_TREE.slug}`,
    );
    await expect(group.getByTestId('category-group-link')).toContainText(FIXED_CATEGORY_TREE.name);
    await expect(group.getByTestId('category-group-count')).toHaveText(
      icuPlural(messages.Home.productCount, DEMO_CATEGORY_COUNTS['mantenimiento-del-coche']),
    );

    // Position order, with the empty child (filtros-de-combustible) left out.
    const populated = FIXED_CATEGORY_TREE.children.filter(
      (child) => DEMO_CATEGORY_COUNTS[child.slug] > 0,
    );
    expect(populated.length).toBeGreaterThan(0);
    expect(populated.length).toBeLessThan(FIXED_CATEGORY_TREE.children.length);
    const rows = group.getByTestId('category-row-link');
    await expect(rows).toHaveCount(populated.length);
    const counts = group.getByTestId('category-row-count');
    for (const [index, child] of populated.entries()) {
      await expect(rows.nth(index)).toHaveAttribute('href', `/categoria/${child.slug}`);
      await expect(rows.nth(index)).toContainText(child.name);
      await expect(counts.nth(index)).toHaveText(
        icuPlural(messages.Home.productCount, DEMO_CATEGORY_COUNTS[child.slug]),
      );
    }

    // Never a zero count.
    expect(await page.getByTestId('category-tree').textContent()).not.toMatch(/(^|\D)0 producto/);
    await expectLocalScriptsAndLinks(page);
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
    expect(entries.length).toBeGreaterThanOrEqual(2);

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
