import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { DEMO_SHARED, DEMO_SHOP_HOSTS } from '../fixtures/demo';
import { CAR, CONTROL_PAGES, UNKNOWN_SLUG, ownerIdentityConfigured, scriptedControl, selectedText } from '../support/car';
import { expectNoForeignOrigin, expectNoSetCookie, openRawHtml } from '../support/page-checks';

// US-5.7 (T5.7.4, L4) against the Compose stack: what holds across every page once a car is
// selected. Search engines (ACs 51 to 54), cookies (55), logs (56), no options route (57), and the
// /go click-out (48, 50). Reflow (58 to 60) is in reflow.spec.ts; the click-row half of 49 is an
// integration test (every e2e offer is a demo offer, so no counted row is reachable here).

const PRODUCT = `/producto/${DEMO_SHARED.slug}`;
const legalPaths = new Set(['/aviso-legal', '/privacidad']);
// The legal pages answer 500 while the owner identity is blank; they are checked only when it is set.
const PAGES: [string, string][] = [...CONTROL_PAGES, ['product', PRODUCT], ['car picker', '/mi-coche']].filter(
  ([, path]) => !legalPaths.has(path) || ownerIdentityConfigured(),
) as [string, string][];

const withParam = (path: string, value: string): string => `${path}${path.includes('?') ? '&' : '?'}coche=${value}`;

const robotsOf = async (page: Page): Promise<string[]> =>
  page.locator('meta[name="robots"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''));
const canonicalsOf = async (page: Page): Promise<string[]> =>
  page.locator('link[rel="canonical"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));

test.describe('search engines (ACs 51 to 54)', () => {
  const values: [string, string][] = [
    ['a valid car', CAR.slug],
    ['an unknown car', UNKNOWN_SLUG],
    ['a malformed value', 'NO%20ES%20UN%20SLUG'],
    ['an empty value', ''],
  ];

  for (const [name, path] of PAGES) {
    for (const [what, value] of values) {
      test(`AC 51, 52: ${name} opened with ${what} is noindex and its canonical, if any, has no coche`, async ({
        request,
        browser,
      }) => {
        const response = await request.get(withParam(path, value), { maxRedirects: 0 });
        expect(response.status(), 'the page answers').toBeLessThan(600);
        expectNoSetCookie(response);
        const { page, close } = await openRawHtml(browser, await response.text());
        try {
          const robots = await robotsOf(page);
          expect(robots.some((content) => /noindex/.test(content)), `robots meta: ${robots.join(' | ')}`).toBe(true);
          for (const href of await canonicalsOf(page)) expect(href).not.toContain('coche');
        } finally {
          await close();
        }
      });
    }
  }

  test('AC 54: the home page opened without coche keeps its canonical and no noindex', async ({
    request,
    browser,
    baseURL,
  }) => {
    const { page, close } = await openRawHtml(browser, await (await request.get('/')).text());
    try {
      expect(await canonicalsOf(page)).toEqual([`${new URL(baseURL ?? '').origin}/`]);
      expect((await robotsOf(page)).filter((content) => /noindex/.test(content))).toEqual([]);
    } finally {
      await close();
    }
  });

  test('AC 54: the legal pages opened without coche stay indexable, with coche they do not', async ({ request, browser }) => {
    test.skip(!ownerIdentityConfigured(), 'the legal pages answer 500 while the owner identity is blank');
    for (const path of legalPaths) {
      const bare = await request.get(path);
      expect(bare.status()).toBe(200);
      const first = await openRawHtml(browser, await bare.text());
      expect((await robotsOf(first.page)).filter((content) => /noindex/.test(content)), `${path} without coche`).toEqual([]);
      await first.close();
      const carry = await openRawHtml(browser, await (await request.get(withParam(path, CAR.slug))).text());
      expect((await robotsOf(carry.page)).some((content) => /noindex/.test(content)), `${path} with coche`).toBe(true);
      await carry.close();
    }
  });

  test('AC 54: a demo page that was noindex without coche is noindex still, and /mi-coche is never indexable', async ({
    request,
    browser,
  }) => {
    for (const path of ['/categoria/filtros-de-aire', PRODUCT, '/mi-coche']) {
      const { page, close } = await openRawHtml(browser, await (await request.get(path)).text());
      expect((await robotsOf(page)).some((content) => /noindex/.test(content)), path).toBe(true);
      await close();
    }
  });

  test('AC 53: no sitemap file names coche, nor does robots.txt beyond its /mi-coche rule, whether or not the request carries it', async ({ request }) => {
    for (const query of ['', `?coche=${CAR.slug}`]) {
      const index = await request.get(`/sitemap.xml${query}`);
      expect(index.status()).toBe(200);
      const indexBody = await index.text();
      expect(indexBody).not.toContain('coche');
      const locs = [...indexBody.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
      expect(locs.length).toBeGreaterThan(0);
      for (const loc of locs) {
        const file = await request.get(`${new URL(loc).pathname}${query}`);
        expect(file.status()).toBe(200);
        expect(await file.text()).not.toContain('coche');
      }
      // robots.txt disallows the /mi-coche path on purpose; it names no query parameter.
      const robots = await request.get(`/robots.txt${query}`);
      expect((await robots.text()).replace('/mi-coche', '')).not.toContain('coche');
    }
  });
});

test.describe('no cookie (AC 55, 57)', () => {
  test('AC 55: no public response, /mi-coche step or unknown route sets a cookie', async ({ request }) => {
    const paths = [
      ...PAGES.map(([, path]) => withParam(path, CAR.slug)),
      '/mi-coche?volver=%2F',
      '/mi-coche?make=x',
      `/mi-coche?volver=%2F&coche=${CAR.slug}`,
      '/api/vehiculos',
    ];
    for (const path of paths) {
      const response = await request.get(path, { maxRedirects: 0 });
      expectNoSetCookie(response);
    }
  });

  test('AC 55: after selecting a car and browsing the cookie jar is empty, no response sets a cookie and nothing leaves the origin', async ({
    page,
    context,
    baseURL,
  }) => {
    const requested: string[] = [];
    const cookieHeaders: string[] = [];
    page.on('request', (req) => requested.push(req.url()));
    page.on('response', async (res) => {
      if (res.url().startsWith(baseURL ?? '')) {
        const header = (await res.allHeaders())['set-cookie'];
        if (header !== undefined) cookieHeaders.push(`${res.url()}: set-cookie`);
      }
    });

    await page.goto('/categoria/mantenimiento-del-coche');
    await scriptedControl(page, false);
    await page.getByTestId('car-select').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('car-picker-option').filter({ hasText: CAR.make }).first().click();
    await dialog.getByTestId('car-picker-option').filter({ hasText: `${CAR.model} ${CAR.generation}` }).first().click();
    await dialog.getByTestId('car-picker-option').filter({ hasText: CAR.engine }).first().click();
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));

    for (const path of ['/', '/buscar?q=filtro', PRODUCT, '/categoria/filtros-de-aire', '/no-existe']) {
      await page.goto(path);
      await expect(page.getByTestId('car-control')).toBeVisible();
      expect(await context.cookies(), path).toEqual([]);
    }
    await page.goto('/mi-coche?volver=%2F');
    expect(await context.cookies()).toEqual([]);
    expect(cookieHeaders).toEqual([]);
    expectNoForeignOrigin(requested, new URL(baseURL ?? '').origin);
  });

  test('AC 57: /api/vehiculos answers 404 to every method, with no cookie and no JSON options body', async ({ request }) => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await request.fetch('/api/vehiculos', { method, maxRedirects: 0 });
      expect(response.status(), method).toBe(404);
      expectNoSetCookie(response);
      expect(response.headers()['content-type'] ?? '', method).not.toContain('json');
    }
    expect((await request.get('/api/vehiculos?coche=' + CAR.slug)).status()).toBe(404);
  });
});

// AC 56, in the pattern of search-privacy.spec.ts: the app container's output holds no slug.
test.describe('the selected slug is in no application log (AC 56)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  const marker = `zq${[...randomBytes(10)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('')}`;

  const logs = (): string => {
    const result = spawnSync('docker', ['compose', 'logs', 'app', '--no-log-prefix'], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
  };

  test('selecting a car and browsing leaves its slug, an unknown slug and coche= out of the output', async ({
    page,
    request,
  }) => {
    expect(logs(), 'docker compose logs answered').toContain('Ready');

    // Through the browser: select, then follow pages.
    await page.goto(withParam('/categoria/mantenimiento-del-coche', CAR.slug));
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));
    for (const path of ['/', '/buscar?q=filtro', PRODUCT]) {
      await page.goto(withParam(path, CAR.slug));
      await expect(page.getByTestId('car-control')).toBeVisible();
    }
    // Through the server: the no-script picker steps, an unknown value, the click-out.
    for (const path of [
      `/mi-coche?volver=${encodeURIComponent(withParam('/', CAR.slug))}`,
      withParam('/', marker),
      withParam('/', 'NO%20ES'),
      withParam('/categoria/filtros-de-aire', CAR.slug),
    ]) {
      await request.get(path);
    }
    const html = await (await request.get(withParam(PRODUCT, CAR.slug))).text();
    const href = /href="(\/go\/\d+)"/.exec(html)?.[1];
    expect(href).toBeTruthy();
    await request.get(href as string, { maxRedirects: 0 });

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = logs();
    for (const secret of [CAR.slug, encodeURIComponent(CAR.slug), marker, 'coche=']) {
      expect(after.includes(secret), `the app container output holds ${secret === marker ? 'the marker' : secret}`).toBe(false);
    }
  });
});

// AC 48 and 50: the click-out. The Location is the shop's own address, and the page the browser
// came from reaches the shop at most as an origin.
test.describe('the click-out from a page opened with coche (ACs 48, 50)', () => {
  const hrefOf = async (request: APIRequestContext): Promise<string> => {
    const html = await (await request.get(withParam(PRODUCT, CAR.slug))).text();
    const href = /href="(\/go\/\d+)"/.exec(html)?.[1];
    expect(href).toBeTruthy();
    return href as string;
  };

  test('AC 48: every /go link on the page carries no coche and the redirect Location carries none', async ({
    request,
    baseURL,
  }) => {
    const html = await (await request.get(withParam(PRODUCT, CAR.slug))).text();
    const hrefs = [...html.matchAll(/href="(\/go\/[^"]*)"/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).not.toContain('coche');

    const href = hrefs[0];
    const plain = await request.get(href, { maxRedirects: 0 });
    const withReferer = await request.get(href, {
      maxRedirects: 0,
      headers: { referer: `${baseURL}${withParam(PRODUCT, CAR.slug)}` },
    });
    const withQuery = await request.get(`${href}?coche=${CAR.slug}`, { maxRedirects: 0 });
    for (const response of [plain, withReferer, withQuery]) {
      expect(response.status()).toBe(302);
      expectNoSetCookie(response);
      const location = response.headers()['location'];
      expect(DEMO_SHOP_HOSTS as readonly string[]).toContain(new URL(location).hostname);
      expect(location).not.toContain('coche');
      expect(location).toBe(plain.headers()['location']);
    }
  });

  test('AC 50: the shop request that follows a click carries no coche in its Referer, at most our origin', async ({
    page,
    context,
    baseURL,
  }) => {
    const goRequests: { url: string; referer: string | undefined }[] = [];
    page.on('request', async (req) => {
      if (new URL(req.url()).pathname.startsWith('/go/')) {
        goRequests.push({ url: req.url(), referer: (await req.allHeaders())['referer'] });
      }
    });

    await page.goto(withParam(PRODUCT, CAR.slug));
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));
    expect(new URL(page.url()).searchParams.get('coche'), 'the page was opened with coche').toBe(CAR.slug);

    const shopRequest = page.waitForRequest((req) => DEMO_SHOP_HOSTS.some((host) => new URL(req.url()).hostname === host));
    await page.getByTestId('offer-go').first().click();
    const shop = await shopRequest;

    // The link itself and the same-origin hop: no coche in the address.
    expect(goRequests).toHaveLength(1);
    expect(goRequests[0].url).not.toContain('coche');
    // The shop: whatever Referer the browser sent holds no coche, and is at most the origin.
    const referer = (await shop.allHeaders())['referer'];
    expect(referer ?? '').not.toContain('coche');
    if (referer !== undefined) {
      const url = new URL(referer);
      expect(url.origin).toBe(new URL(baseURL ?? '').origin);
      expect(url.pathname).toBe('/');
      expect(url.search).toBe('');
    }
    expect(await context.cookies()).toEqual([]);
  });

  test('AC 50 control: the offer link is a plain anchor, so the browser default Referer policy is what applies', async ({
    request,
  }) => {
    const html = await (await request.get(withParam(PRODUCT, CAR.slug))).text();
    const anchors = [...html.matchAll(/<a\b[^>]*href="\/go\/[^"]*"[^>]*>/g)].map((match) => match[0]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(anchor).not.toMatch(/referrerpolicy|rel="[^"]*noreferrer/i);
    }
    expect(await hrefOf(request)).toMatch(/^\/go\/\d+$/);
  });
});
