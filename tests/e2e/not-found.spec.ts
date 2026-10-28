import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { loadEnv } from '../support/env';
import { expectNoSetCookie } from '../support/page-checks';

// S11.6: the public 404 is a Secondary button inside one chrome, with its own tab
// title. The nested 404 body is client-rendered, so the DOM checks run in a browser.

loadEnv();
const siteName = (process.env.SITE_NAME ?? '').trim();

/** The four public 404 URLs: the root file (unmatched top level) and three raised inside (public). */
const NOT_FOUND_URLS = [
  '/no-existe',
  '/categoria/no-existe',
  '/producto/no-existe',
  '/categoria/mantenimiento-del-coche?pagina=4',
] as const;
const NESTED_URLS = NOT_FOUND_URLS.slice(1);

const homeLink = (page: Page) => page.getByRole('main').getByRole('link', { name: messages.NotFound.backHome });

test.describe('public 404 (S11.6)', () => {
  for (const url of NOT_FOUND_URLS) {
    test(`${url}: answers 404, no cookie, and sets the tab title`, async ({ page, request }) => {
      const served = await request.get(url);
      expect(served.status()).toBe(404);
      expectNoSetCookie(served);
      const response = await page.goto(url);
      expect(response?.status()).toBe(404);
      await expect(homeLink(page)).toBeVisible();
      await expect(page).toHaveTitle(messages.NotFound.metaTitle.replace('{siteName}', siteName));
    });

    test(`${url}: one header, one footer, one main and one heading`, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: messages.NotFound.heading })).toBeVisible();
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    });
  }

  for (const width of [375, 1280]) {
    test.describe(`at ${width} wide`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('the way back home is a bordered button at least 44px tall, not a bare link', async ({ page }) => {
        await page.goto('/no-existe');
        const link = homeLink(page);
        await expect(link).toHaveText(messages.NotFound.backHome);
        await expect(link).toHaveAttribute('href', '/');
        const box = (await link.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        const style = await link.evaluate((node) => {
          const s = getComputedStyle(node);
          return { border: parseFloat(s.borderTopWidth), borderStyle: s.borderTopStyle, decoration: s.textDecorationLine };
        });
        expect(style.border).toBeGreaterThanOrEqual(1);
        expect(style.borderStyle).toBe('solid');
        expect(style.decoration).toBe('none');
      });

      test('the keyboard ring is 3px solid with a 2px offset', async ({ page }) => {
        await page.goto('/no-existe');
        const link = homeLink(page);
        for (let stop = 0; stop < 6; stop += 1) {
          await page.keyboard.press('Tab');
          if (await link.evaluate((node) => node === document.activeElement)) break;
        }
        await expect(link).toBeFocused();
        const ring = await link.evaluate((node) => {
          const s = getComputedStyle(node);
          return { width: parseFloat(s.outlineWidth), style: s.outlineStyle, offset: parseFloat(s.outlineOffset) };
        });
        expect(ring).toEqual({ width: 3, style: 'solid', offset: 2 });
      });

      test('the nested 404 button has the same size as the top-level one', async ({ page }) => {
        await page.goto('/no-existe');
        const top = (await homeLink(page).boundingBox())!;
        for (const url of NESTED_URLS) {
          await page.goto(url);
          const nested = (await homeLink(page).boundingBox())!;
          expect(nested.height, url).toBe(top.height);
          expect(nested.width, url).toBe(top.width);
        }
      });

      test('no 404 page scrolls sideways', async ({ page }) => {
        for (const url of NOT_FOUND_URLS) {
          await page.goto(url);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, url).toBeLessThanOrEqual(0);
        }
      });
    });
  }

  test('the Tab walk on a nested 404 is the site link, the button, then the footer links only', async ({ page }) => {
    await page.goto('/producto/no-existe');
    await expect(homeLink(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
    const stops: string[] = [];
    for (let stop = 0; stop < 5; stop += 1) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute('href') ?? ''));
    }
    // Stop 1 is the site link and stop 2 the button; both go home. The rest sit in the footer.
    expect(stops[0]).toBe('/');
    expect(stops[1]).toBe('/');
    const footerHrefs = await page.getByRole('contentinfo').getByRole('link').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href')),
    );
    expect(footerHrefs).toHaveLength(3);
    expect(stops.slice(2)).toEqual(footerHrefs);
  });

  test('the way back home leads to the home page', async ({ page }) => {
    await page.goto('/categoria/no-existe');
    await homeLink(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('banner')).toHaveCount(1);
  });
});
