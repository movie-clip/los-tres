import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED } from '../fixtures/demo';
import {
  CAR,
  CONTROL_PAGES,
  OTHER_MAKE,
  UNKNOWN_SLUG,
  carName,
  ownerIdentityConfigured,
  scriptedControl,
  selectedText,
  withoutCarLinks,
} from '../support/car';
import { stripScripts } from '../support/page-checks';

// US-5.7 (T5.7.3, L2t) against the Compose stack: the car control in the header (ACs 1 to 6), the
// unknown-car notice (ACs 39 to 41), the header tab order (AC 61) and the forged request headers
// (the proxy deletes x-car-slug and x-car-path before it sets them). The picker flows are in
// car-picker-nojs.spec.ts and car-dialog.spec.ts, the stored choice in car-storage.spec.ts.

const PRODUCT = `/producto/${DEMO_SHARED.slug}`;
const PAGES: [string, string][] = [...CONTROL_PAGES, ['product', PRODUCT]];

/** The path with `coche` added last, whatever the path already carries. */
const withCoche = (path: string, slug: string): string =>
  `${path}${path.includes('?') ? '&' : '?'}coche=${slug}`;

const control = (page: Page) => page.getByTestId('car-control');

test.describe('the car control on every public page (ACs 1 to 4)', () => {
  for (const [name, path] of PAGES) {
    test(`AC 1, 2: ${name} shows the no-car action, one group named for the car`, async ({ page, context }) => {
      const response = await page.goto(path);
      expect((await response!.allHeaders())['set-cookie']).toBeUndefined();
      await expect(control(page)).toHaveCount(1);
      await expect(control(page)).toBeVisible();
      await expect(page.getByRole('group', { name: messages.Car.groupLabel })).toBeVisible();
      const select = page.getByTestId('car-select');
      await expect(select).toBeVisible();
      await expect(select).toHaveText(messages.Car.select);
      await expect(page.getByTestId('car-label')).toHaveCount(0);
      await expect(page.getByTestId('car-change')).toHaveCount(0);
      await expect(page.getByTestId('car-remove')).toHaveCount(0);
      await expect(page.getByTestId('car-notice')).toHaveCount(0);
      // With script the action is a button that opens a dialog.
      await scriptedControl(page, false);
      await expect(select).toHaveRole('button');
      expect(await context.cookies()).toEqual([]);
    });
  }

  for (const [name, path] of PAGES) {
    test(`AC 3: ${name} with a car states it in words, with a change and a remove action`, async ({ page }) => {
      await page.goto(withCoche(path, CAR.slug));
      await expect(control(page)).toHaveCount(1);
      const label = page.getByTestId('car-label');
      await expect(label).toHaveText(selectedText(CAR));
      // The make, model, generation and engine are in the label (AC 3).
      for (const part of [CAR.make, CAR.model, CAR.generation, CAR.engine]) {
        await expect(label).toContainText(part);
      }
      await expect(label.locator('strong')).toHaveText(carName(CAR));
      await expect(page.getByRole('button', { name: messages.Car.changeLabel })).toBeVisible();
      await expect(page.getByRole('link', { name: messages.Car.removeLabel })).toBeVisible();
      await expect(page.getByTestId('car-select')).toHaveCount(0);
      await expect(page.getByTestId('car-notice')).toHaveCount(0);
    });
  }

  test('AC 4: the search results page hides the header search box but keeps the car control', async ({ page }) => {
    await page.goto('/buscar?q=filtro');
    await expect(page.getByTestId('header-search')).toBeHidden();
    await expect(control(page)).toBeVisible();
    await expect(page.getByTestId('car-select')).toBeVisible();
    await page.goto(withCoche('/buscar?q=filtro', CAR.slug));
    await expect(page.getByTestId('header-search')).toBeHidden();
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));
  });

  test('AC 1: the 404 page answers 404 and carries the control', async ({ page }) => {
    const response = await page.goto('/esta-pagina-no-existe');
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('car-select')).toBeVisible();
  });

  test('AC 1: a missing product with a car still answers 404, and shows the car', async ({ page }) => {
    const response = await page.goto(withCoche('/producto/no-existe-este-producto', CAR.slug));
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));
  });

  test('AC 6: the admin sign-in page shows no car control', async ({ page }) => {
    await page.goto('/admin/acceso');
    await expect(page.getByTestId('car-control')).toHaveCount(0);
    await expect(page.getByTestId('car-select')).toHaveCount(0);
    await page.goto(withCoche('/admin/acceso', CAR.slug));
    await expect(page.getByTestId('car-control')).toHaveCount(0);
  });
});

test.describe('the error page carries the control (AC 1, AC 5)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  // The same one-off container as search-privacy.spec.ts: a server whose database is unreachable,
  // so a search ends on the public error page. The header around it must still draw the control,
  // in the no-car state, and must not raise an error of its own.
  test('a failing page shows the generic error and, in the header, the no-car action', async ({ browser }) => {
    const name = `los-tres-e2e-car-error-${randomBytes(6).toString('hex')}`;
    const docker = (args: string[], timeout = 60_000) => {
      const result = spawnSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
      return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    };
    const run = docker(
      [
        'compose', 'run', '-d', '--no-deps', '--name', name, '-p', '127.0.0.1::3000',
        '--entrypoint', 'node',
        '-e', 'DATABASE_URL=postgres://x:x@127.0.0.1:1/x',
        'app', 'server.js',
      ],
      120_000,
    );
    try {
      expect(run.status, run.out).toBe(0);
      const mapping = docker(['port', name, '3000/tcp']).out.trim().split(/\r?\n/)[0] ?? '';
      const port = /:(\d+)$/.exec(mapping)?.[1];
      expect(port, `docker port said: ${mapping}`).toBeDefined();
      const origin = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
        ready = await fetch(`${origin}/robots.txt`).then((r) => r.status === 200, () => false);
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(ready, 'the failing server started').toBe(true);

      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(`${origin}/buscar?q=filtro`);
      expect(response?.status()).toBe(500);
      await expect(page.getByTestId('public-error')).toBeVisible();
      await expect(page.getByTestId('car-control')).toBeVisible();
      await expect(page.getByTestId('car-select')).toHaveText(messages.Car.select);
      await expect(page.getByTestId('car-label')).toHaveCount(0);
      await expect(page.getByTestId('car-notice')).toHaveCount(0);
      expect(errors).toEqual([]);
      expect(await context.cookies()).toEqual([]);
      await context.close();
    } finally {
      docker(['rm', '-f', name]);
    }
  });
});

test.describe('the notice for a car the site does not know (ACs 39 to 41)', () => {
  // An unknown slug, a malformed value, an empty one and a repeated one are all "unrecognised".
  const BAD: [string, string][] = [
    ['an unknown slug', `coche=${UNKNOWN_SLUG}`],
    ['a malformed value', 'coche=Mal%20Formado%21'],
    ['an empty value', 'coche='],
    ['a repeated coche', `coche=${CAR.slug}&coche=${OTHER_MAKE.slug}`],
  ];
  // The two owner-identity pages are 500 while the host .env leaves the owner blank: no body, no notice.
  const legal: [string, string][] = ownerIdentityConfigured()
    ? [['aviso legal', '/aviso-legal'], ['privacidad', '/privacidad']]
    : [];
  const NOTICE_PAGES: [string, string][] = [
    ['home', '/'],
    ['category', '/categoria/mantenimiento-del-coche'],
    ['product', PRODUCT],
    ['search', '/buscar?q=filtro'],
    ...legal,
    ['como nos financiamos', '/como-nos-financiamos'],
  ];
  const join = (path: string, query: string) => `${path}${path.includes('?') ? '&' : '?'}${query}`;

  for (const [pageName, path] of NOTICE_PAGES) {
    test(`AC 40: ${pageName} with an unknown slug shows the notice first in main and the no-car action`, async ({ page }) => {
      await page.goto(join(path, `coche=${UNKNOWN_SLUG}`));
      const notice = page.getByTestId('car-notice');
      await expect(notice).toHaveCount(1);
      await expect(notice).toHaveText(messages.Car.unknownNotice);
      await expect(notice).toHaveAttribute('role', 'note');
      await expect(page.getByRole('note').filter({ hasText: messages.Car.unknownNotice })).toHaveCount(1);
      await expect(page.getByTestId('car-select')).toBeVisible();
      await expect(page.getByTestId('car-label')).toHaveCount(0);
      // First child of main: nothing visible precedes it inside main.
      const first = await page.locator('main').first().evaluate((main) => {
        const node = main.firstElementChild;
        if (node === null) return '';
        if (node.getAttribute('data-testid') === 'car-notice') return 'car-notice';
        // The home page wraps the notice in the page div, ahead of the masthead.
        return node.firstElementChild?.getAttribute('data-testid') ?? node.getAttribute('data-testid') ?? '';
      });
      expect(first).toBe('car-notice');
    });
  }

  for (const [badName, query] of BAD) {
    test(`AC 39, 40: ${badName} renders the product page as without coche, apart from the notice`, async ({ page, request }) => {
      const url = join(PRODUCT, query);
      const response = await request.get(url);
      expect(response.status()).toBe((await request.get(PRODUCT)).status());
      expect(response.headers()['set-cookie']).toBeUndefined();

      const text = async (target: string) => {
        await page.goto(target);
        await expect(page.getByTestId('car-control')).toBeVisible();
        return page.locator('main').first().evaluate((main) => {
          const clone = main.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('[data-testid="car-notice"]').forEach((node) => node.remove());
          return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
        });
      };
      const without = await text(PRODUCT);
      const withBad = await text(url);
      expect(withBad).toBe(without);
      await expect(page.getByTestId('car-notice')).toHaveText(messages.Car.unknownNotice);
      await expect(page.getByTestId('car-select')).toBeVisible();
      await expect(page.getByTestId('car-label')).toHaveCount(0);
    });
  }

  test('AC 39: a missing page with an unknown car keeps its 404 status', async ({ request }) => {
    for (const path of ['/producto/no-existe-este-producto', '/categoria/no-existe', '/pagina-que-no-existe']) {
      const response = await request.get(`${path}?coche=${UNKNOWN_SLUG}`);
      expect(response.status(), path).toBe(404);
    }
  });

  test('AC 41: no link on the page carries the unrecognised value', async ({ page }) => {
    for (const query of [`coche=${UNKNOWN_SLUG}`, 'coche=Mal%20Formado%21']) {
      for (const path of ['/', '/categoria/mantenimiento-del-coche', PRODUCT]) {
        await page.goto(join(path, query));
        await expect(page.getByTestId('car-notice')).toBeVisible();
        const hrefs = await page.locator('a[href]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href') ?? ''));
        for (const href of hrefs) {
          expect(href, `${path} link ${href}`).not.toContain(UNKNOWN_SLUG);
          expect(href, `${path} link ${href}`).not.toMatch(/(^|[?&])coche=(?!$|&)/);
        }
      }
    }
  });

  test('AC 40: a valid car shows no notice; a page without coche shows none', async ({ page }) => {
    await page.goto(withCoche('/', CAR.slug));
    await expect(page.getByTestId('car-notice')).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByTestId('car-notice')).toHaveCount(0);
  });
});

test.describe('forged car request headers are never believed (the proxy owns them)', () => {
  const FORGED_PATH = '/zz-forged-path-marker';

  for (const [name, path] of [['home', '/'], ['product', PRODUCT], ['como nos financiamos', '/como-nos-financiamos']] as const) {
    test(`${name}: x-car-slug and x-car-path with no coche render no car`, async ({ request }) => {
      const response = await request.get(path, {
        headers: { 'x-car-slug': CAR.slug, 'x-car-path': FORGED_PATH },
      });
      expect(response.status()).toBe(200);
      expect(response.headers()['set-cookie']).toBeUndefined();
      const html = stripScripts(await response.text());
      expect(html).toContain('data-testid="car-select"');
      expect(html).not.toContain('data-testid="car-label"');
      expect(html).not.toContain('data-testid="car-notice"');
      expect(html).not.toContain(carName(CAR));
      // The forged path is not what the no-script links return to.
      expect(html).not.toContain('zz-forged-path-marker');
    });
  }

  test('a forged header cannot swap the car named in the URL, nor turn a bad one into a good one', async ({ request }) => {
    const swapped = await request.get(withCoche('/', CAR.slug), {
      headers: { 'x-car-slug': OTHER_MAKE.slug, 'x-car-path': FORGED_PATH },
    });
    const swappedHtml = stripScripts(await swapped.text());
    expect(swappedHtml).toContain(carName(CAR));
    expect(swappedHtml).not.toContain(carName(OTHER_MAKE));
    expect(swappedHtml).not.toContain('zz-forged-path-marker');

    const unknown = await request.get(withCoche('/', UNKNOWN_SLUG), {
      headers: { 'x-car-slug': CAR.slug },
    });
    const unknownHtml = stripScripts(await unknown.text());
    expect(unknownHtml).toContain('data-testid="car-notice"');
    expect(unknownHtml).not.toContain('data-testid="car-label"');
  });

  test('the legacy header names the proxy renamed are not read either', async ({ request }) => {
    const response = await request.get('/', {
      headers: { 'x-lostres-coche': CAR.slug, 'x-lostres-path': FORGED_PATH },
    });
    const html = stripScripts(await response.text());
    expect(html).not.toContain('data-testid="car-label"');
    expect(html).not.toContain('zz-forged-path-marker');
  });

  test('a forged x-car-slug on the 404 page renders no car', async ({ request }) => {
    const response = await request.get('/esta-pagina-no-existe', { headers: { 'x-car-slug': CAR.slug } });
    expect(response.status()).toBe(404);
    expect(stripScripts(await response.text())).not.toContain('data-testid="car-label"');
  });
});

test.describe('the page query in the no-script links (AC 20)', () => {
  test('a term in the address appears in the markup only inside the car links volver, never anywhere else', async ({ request }) => {
    const token = 'zqcarvolver81';
    for (const path of [`/?q=${token}`, `/categoria/filtros-de-aire?marca=${token}`, `/buscar?q=${token}`]) {
      for (const suffix of ['', `&coche=${CAR.slug}`]) {
        const response = await request.get(`${path}${suffix}`);
        const html = stripScripts(await response.text());
        const neutral = withoutCarLinks(html);
        // The search page shows its own term in its field (S5.4); the others never echo it.
        if (!path.startsWith('/buscar')) expect(neutral, path).not.toContain(token);
        // And the links that do carry it are the picker links, under an encoded volver.
        const carriers = html.match(/<a\b[^>]*href="[^"]*"[^>]*>/g)?.filter((tag) => tag.includes(token)) ?? [];
        for (const tag of carriers) {
          if (path.startsWith('/buscar')) continue;
          expect(tag, path).toMatch(/data-testid="car-(select|change|remove)"/);
        }
      }
    }
  });
});

test.describe('the header keyboard order (AC 61)', () => {
  test('no car: site name, search field, search button, then the select action', async ({ page }) => {
    await page.goto(PRODUCT);
    await scriptedControl(page, false);
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('site-header-link')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('header-search-input')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('header-search-button')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('car-select')).toBeFocused();
  });

  test('with a car: ..., search button, change, then remove; the label is not a tab stop', async ({ page }) => {
    await page.goto(withCoche(PRODUCT, CAR.slug));
    await scriptedControl(page, true);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('car-label')).toHaveAttribute('tabindex', '-1');
    for (const id of ['site-header-link', 'header-search-input', 'header-search-button', 'car-change', 'car-remove']) {
      await page.keyboard.press('Tab');
      await expect(page.getByTestId(id)).toBeFocused();
    }
  });
});
