import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED } from '../fixtures/demo';
import { loadEnv } from '../support/env';
import {
  cssColour,
  expectNoSetCookie,
  expectServerRenderedNotFound,
  snapshotOf,
  stripScripts,
} from '../support/page-checks';

// S11.6: the public 404 is a Secondary button inside one chrome, with its own tab
// title. S11.7: the nested 404 is also a full server-rendered page (src/proxy.ts rewrites a
// missing product or category to the root not-found), so the served body is checked with the
// scripts stripped, and the DOM checks run in a browser as before.

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
/**
 * Every shape of a missing catalogue page the proxy decides: unknown product, unknown category, a page
 * past the last, and a real brand past its last page (no demo brand has a second page).
 */
const MISSING_URLS = [...NESTED_URLS, '/categoria/mantenimiento-del-coche?marca=bosch&pagina=2'] as const;

const homeLink = (page: Page) => page.getByRole('main').getByRole('link', { name: messages.NotFound.backHome });

test.describe('nested 404 server HTML (S11.7)', () => {
  for (const url of MISSING_URLS) {
    test(`${url}: the script-stripped body is the full 404 page, status 404, no cookie`, async ({ request }) => {
      const served = await request.get(url);
      expect(served.status()).toBe(404);
      expectNoSetCookie(served);
      expectServerRenderedNotFound(await served.text(), siteName, url);
    });

    test(`${url}: with JavaScript off it is styled like /no-existe`, async ({ browser, baseURL }) => {
      for (const width of [375, 1280]) {
        const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width, height: 800 } });
        const page = await context.newPage();
        await page.goto(url);
        const ink = await cssColour(page, 'var(--color-ink)');
        await expect(page.getByRole('banner'), `${url} @${width}`).toHaveCount(1);
        await expect(page.getByRole('contentinfo')).toHaveCount(1);
        expect(await snapshotOf(page.getByRole('banner'))).toMatchObject({ background: ink });
        expect(await snapshotOf(page.getByRole('contentinfo'))).toMatchObject({ background: ink });
        const link = homeLink(page);
        await expect(link).toHaveText(messages.NotFound.backHome);
        const box = (await link.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        const border = await link.evaluate((node) => parseFloat(getComputedStyle(node).borderTopWidth));
        expect(border).toBeGreaterThanOrEqual(1);
        await context.close();
      }
    });
  }

  test('the unmatched URL and a nested one serve the same chrome', async ({ request }) => {
    const reference = stripScripts(await (await request.get('/no-existe')).text());
    for (const url of MISSING_URLS) {
      const nested = stripScripts(await (await request.get(url)).text());
      for (const tag of ['<header', '<main', '<footer', '<h1', '<title']) {
        expect(nested.split(tag).length, `${url} ${tag}`).toBe(reference.split(tag).length);
      }
    }
  });

  test('the stripped-body check rejects the framework error shell, whose flight payload carries the same words', () => {
    const shell =
      '<!DOCTYPE html><html id="__next_error__"><head><title>' +
      messages.NotFound.metaTitle.replace('{siteName}', siteName) +
      '</title><meta name="robots" content="noindex"/></head><body><div hidden></div>' +
      '<script>self.__next_f.push([1,"' +
      messages.NotFound.heading +
      ' ' +
      messages.NotFound.backHome +
      ' <header> <main> <footer>"])</script></body></html>';
    expect(stripScripts(shell)).not.toContain('<h1');
    expect(() => expectServerRenderedNotFound(shell, siteName)).toThrow();
    // and the raw text would have passed the old assertion
    expect(shell).toContain(messages.NotFound.heading);
  });

  test('a product that exists is not rewritten', async ({ request }) => {
    const served = await request.get(`/producto/${DEMO_SHARED.slug}`);
    expect(served.status()).toBe(200);
    expect(served.headers()['x-middleware-rewrite']).toBeUndefined();
    expect(stripScripts(await served.text())).not.toContain(messages.NotFound.heading);
  });
});

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

  test.describe('at 195 wide (200% zoom on a phone)', () => {
    test.use({ viewport: { width: 195, height: 422 } });

    for (const url of NOT_FOUND_URLS) {
      test(`${url}: the heading text stays inside the content box and the page does not scroll sideways`, async ({ page }) => {
        await page.goto(url);
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toBeVisible();
        const edges = await heading.evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          const textRight = Math.max(...[...range.getClientRects()].map((rect) => rect.right));
          const parent = node.parentElement!;
          const padding = parseFloat(getComputedStyle(parent).paddingRight);
          return { textRight, contentRight: parent.getBoundingClientRect().right - padding };
        });
        expect(edges.textRight).toBeLessThanOrEqual(edges.contentRight + 0.5);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });

  test('the Tab walk on a nested 404 is the site link, the header search, the button, then the footer links only', async ({ page }) => {
    await page.goto('/producto/no-existe');
    await expect(homeLink(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
    const stops: string[] = [];
    for (let stop = 0; stop < 7; stop += 1) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute('href') ?? ''));
    }
    // Stop 1 is the site link, stops 2 and 3 the header search field and button (no href), stop 4
    // the 404 button; the links go home. The rest sit in the footer.
    expect(stops[0]).toBe('/');
    expect(stops.slice(1, 3)).toEqual(['', '']);
    expect(stops[3]).toBe('/');
    const footerHrefs = await page.getByRole('contentinfo').getByRole('link').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href')),
    );
    expect(footerHrefs).toHaveLength(3);
    expect(stops.slice(4)).toEqual(footerHrefs);
  });

  test('the way back home leads to the home page', async ({ page }) => {
    await page.goto('/categoria/no-existe');
    await homeLink(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('banner')).toHaveCount(1);
  });
});
