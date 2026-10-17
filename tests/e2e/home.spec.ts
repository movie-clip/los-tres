import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { appBaseUrl, loadEnv } from '../support/env';

loadEnv();
const siteName = (process.env.SITE_NAME ?? '').trim();
const origin = new URL(appBaseUrl()).origin;

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
    expect(response.headers()['set-cookie']).toBeUndefined();

    // Parse the raw server HTML in a context with JavaScript off.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.setContent(await response.text());

    await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(siteName);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('p')).toHaveCount(1);
    await expect(page.locator('p')).toHaveText(messages.Home.tagline);
    expect(await page.title()).toContain(siteName);

    // No third-party script or off-site link.
    const scriptSources = await page.locator('script[src]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('src') ?? ''),
    );
    for (const src of scriptSources) {
      expect(src.startsWith('/') && !src.startsWith('//')).toBe(true);
    }
    const hrefs = await page.locator('a[href]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href') ?? ''),
    );
    for (const href of hrefs) {
      expect(href.startsWith('/') && !href.startsWith('//')).toBe(true);
    }
    await context.close();
  });

  test('sets no cookie and contacts no other origin in a real browser visit', async ({
    page,
    context,
  }) => {
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    await page.goto('/');
    await expect(page.locator('h1')).toHaveText(siteName);
    await page.waitForLoadState('networkidle');

    expect(await context.cookies()).toEqual([]);
    const foreign = requested.filter(
      (url) => !url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin,
    );
    expect(foreign).toEqual([]);
  });
});
