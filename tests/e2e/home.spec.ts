import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { loadEnv } from '../support/env';
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
    await expect(page.locator('p')).toHaveCount(1);
    await expect(page.locator('p')).toHaveText(messages.Home.tagline);
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
});
