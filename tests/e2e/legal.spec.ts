import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED } from '../fixtures/demo';
import { loadEnv } from '../support/env';
import {
  expectLegalFooter,
  expectLocalScriptsAndLinks,
  expectNoSetCookie,
  openRawHtml,
} from '../support/page-checks';

// S9.3 legal pages, footer and demo notice against the Compose stack.
// The owner identity is read from the host .env at run time and never written
// into code, titles or snapshots. Whether /aviso-legal and /privacidad answer
// 200 or 500 depends on whether the four required values are filled, so the
// spec branches on the same .env the Compose app was started with.

loadEnv();
const siteName = (process.env.SITE_NAME ?? '').trim();
const env = (name: string): string => (process.env[name] ?? '').trim();
const REQUIRED = ['OWNER_NAME', 'OWNER_NIF', 'OWNER_ADDRESS', 'CONTACT_EMAIL'] as const;
const identityConfigured = REQUIRED.every((name) => env(name) !== '');
const registry = env('OWNER_REGISTRY');

const siteTitle = (message: string) => message.replace('{siteName}', siteName);
const RAW_KEY = /\b(LegalNotice|Privacy|Funding|Footer|DemoNotice)\.[a-zA-Z]+\b/;

test.describe('footer on every page (S9.3)', () => {
  const pages: [string, string, number][] = [
    ['home', '/', 200],
    ['product', `/producto/${DEMO_SHARED.slug}`, 200],
    ['category', '/categoria/mantenimiento-del-coche', 200],
    ['empty category', '/categoria/filtros-de-combustible', 200],
    ['not found', '/esta-pagina-no-existe', 404],
    ['funding', '/como-nos-financiamos', 200],
  ];

  for (const [name, route, status] of pages) {
    test(`${name} has the footer with the three legal links, no cookie`, async ({ request, browser }) => {
      const response = await request.get(route);
      expect(response.status()).toBe(status);
      expectNoSetCookie(response);
      const { page, close } = await openRawHtml(browser, await response.text());
      await expectLegalFooter(page);
      await expectLocalScriptsAndLinks(page);
      await close();
    });
  }

  test('each footer link opens a real page, not the not-found page', async ({ request }) => {
    for (const href of ['/aviso-legal', '/privacidad', '/como-nos-financiamos']) {
      const response = await request.get(href);
      expect([200, 500]).toContain(response.status());
      expect(response.status()).not.toBe(404);
    }
  });
});

test.describe('/como-nos-financiamos (S9.3)', () => {
  test('server-renders the affiliate disclosure without owner data, JavaScript or cookie', async ({
    request,
    browser,
  }) => {
    const response = await request.get('/como-nos-financiamos');
    expect(response.status()).toBe(200);
    expectNoSetCookie(response);
    const { page, close } = await openRawHtml(browser, await response.text());

    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(siteTitle(messages.Funding.heading));
    await expect(page.locator('main h2')).toHaveCount(0);
    await expect(page.locator('main li')).toHaveCount(3);
    await expect(page.locator('main li strong')).toHaveCount(3);
    expect(await page.title()).toBe(siteTitle(messages.Funding.metaTitle));
    const visible = (await page.locator('body').innerText()).trim();
    expect(visible).not.toMatch(/[{}]|\*\*/);
    expect(visible).not.toMatch(RAW_KEY);
    await expectLocalScriptsAndLinks(page);
    await close();
  });
});

test.describe('/aviso-legal and /privacidad (S9.3)', () => {
  for (const route of ['/aviso-legal', '/privacidad']) {
    if (!identityConfigured) {
      test(`${route} answers 500 and shows no raw placeholder while a required owner value is blank`, async ({
        request,
        browser,
      }) => {
        const response = await request.get(route);
        expect(response.status()).toBe(500);
        expectNoSetCookie(response);
        const { page, close } = await openRawHtml(browser, await response.text());
        const visible = await page.locator('body').innerText();
        expect(/[{}]/.test(visible), 'visible text holds a brace').toBe(false);
        await close();
      });
      continue;
    }

    test(`${route} renders the owner values from .env, escaped, with no placeholder`, async ({
      request,
      browser,
    }) => {
      const response = await request.get(route);
      expect(response.status()).toBe(200);
      expectNoSetCookie(response);
      const { page, close } = await openRawHtml(browser, await response.text());

      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);
      const visible = await page.locator('main').innerText();
      // Booleans, so a failure names the field and never prints the value.
      expect(visible.includes(env('OWNER_NAME')), 'owner name shown').toBe(true);
      expect(visible.includes(env('OWNER_NIF')), 'owner NIF shown').toBe(true);
      expect(visible.includes(env('OWNER_ADDRESS')), 'owner address shown').toBe(true);
      expect(visible.includes(env('CONTACT_EMAIL')), 'contact email shown').toBe(true);
      expect(visible).not.toMatch(/[{}]|\*\*/);
      expect(visible).not.toMatch(RAW_KEY);

      const hrefs = await page
        .locator('main a')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
      expect(hrefs).toContain(`mailto:${env('CONTACT_EMAIL')}`);
      await expectLegalFooter(page);
      await expectLocalScriptsAndLinks(page, {
        allowHrefs: [`mailto:${env('CONTACT_EMAIL')}`, 'https://www.aepd.es'],
      });
      await close();
    });
  }

  test('/aviso-legal shows the registry item iff OWNER_REGISTRY is set', async ({ request, browser }) => {
    test.skip(!identityConfigured, 'required owner values are blank: the page answers 500');
    const response = await request.get('/aviso-legal');
    expect(response.status()).toBe(200);
    const { page, close } = await openRawHtml(browser, await response.text());
    const label = messages.LegalNotice.registry.split(':')[0];
    const items = await page.locator('main li').allTextContents();
    if (registry === '') {
      expect(items).toHaveLength(4);
      expect(items.some((item) => item.includes(label))).toBe(false);
      expect((await page.locator('main').innerText()).includes(label)).toBe(false);
    } else {
      expect(items).toHaveLength(5);
      expect(items[4].startsWith(label)).toBe(true);
      expect(items[4].includes(registry), 'registry value shown').toBe(true);
    }
    await close();
  });

  test('/aviso-legal has the six sections and the page title', async ({ request, browser }) => {
    test.skip(!identityConfigured, 'required owner values are blank: the page answers 500');
    const { page, close } = await openRawHtml(browser, await (await request.get('/aviso-legal')).text());
    await expect(page.locator('h1')).toHaveText(messages.LegalNotice.heading);
    await expect(page.locator('main h2')).toHaveCount(6);
    expect(await page.title()).toBe(siteTitle(messages.LegalNotice.metaTitle));
    await close();
  });

  test('/privacidad has the nine sections, the AEPD link and the page title', async ({
    request,
    browser,
  }) => {
    test.skip(!identityConfigured, 'required owner values are blank: the page answers 500');
    const { page, close } = await openRawHtml(browser, await (await request.get('/privacidad')).text());
    await expect(page.locator('h1')).toHaveText(messages.Privacy.heading);
    await expect(page.locator('main h2')).toHaveCount(9);
    await expect(page.locator('main a[href="https://www.aepd.es"]')).toHaveCount(1);
    expect(await page.title()).toBe(siteTitle(messages.Privacy.metaTitle));
    await close();
  });
});

test.describe('demo notice (S9.3)', () => {
  const notice = (page: import('@playwright/test').Page) => page.getByRole('note');

  test('shows on the demo product page, first in main, above the h1', async ({ request, browser }) => {
    const response = await request.get(`/producto/${DEMO_SHARED.slug}`);
    expect(response.status()).toBe(200);
    const { page, close } = await openRawHtml(browser, await response.text());
    await expect(notice(page)).toHaveCount(1);
    await expect(notice(page)).toHaveText(messages.DemoNotice.body);
    await expect(page.locator('main > :first-child')).toHaveAttribute('role', 'note');
    await close();
  });

  for (const route of ['/categoria/mantenimiento-del-coche', '/categoria/mantenimiento-del-coche?pagina=2']) {
    test(`shows on ${route}, first in main`, async ({ request, browser }) => {
      const response = await request.get(route);
      expect(response.status()).toBe(200);
      const { page, close } = await openRawHtml(browser, await response.text());
      await expect(notice(page)).toHaveCount(1);
      await expect(notice(page)).toHaveText(messages.DemoNotice.body);
      await expect(page.locator('main > :first-child')).toHaveAttribute('role', 'note');
      await close();
    });
  }

  for (const route of [
    '/',
    '/categoria/filtros-de-combustible',
    '/esta-pagina-no-existe',
    '/como-nos-financiamos',
  ]) {
    test(`is absent on ${route}`, async ({ request, browser }) => {
      const response = await request.get(route);
      const { page, close } = await openRawHtml(browser, await response.text());
      await expect(notice(page)).toHaveCount(0);
      expect(await response.text()).not.toContain(messages.DemoNotice.body);
      await close();
    });
  }

  test('is absent on the legal pages that are rendered', async ({ request }) => {
    test.skip(!identityConfigured, 'required owner values are blank: the pages answer 500');
    for (const route of ['/aviso-legal', '/privacidad']) {
      const html = await (await request.get(route)).text();
      expect(html).not.toContain(messages.DemoNotice.body);
    }
  });

  test('sets no cookie and asks for no consent on a visit', async ({ page, context }) => {
    await page.goto(`/producto/${DEMO_SHARED.slug}`);
    await expect(page.getByRole('note')).toBeVisible();
    // The only buttons are the header search submit (T5.4.5) and the car control's select action
    // (S5.7); a consent control would be another.
    await expect(page.getByRole('button')).toHaveCount(2);
    await expect(page.getByTestId('header-search-button')).toBeVisible();
    await expect(page.getByTestId('car-select')).toBeVisible();
    expect(await context.cookies()).toEqual([]);
  });
});
