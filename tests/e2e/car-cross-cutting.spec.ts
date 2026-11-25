import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { DEMO_SHARED } from '../fixtures/demo';
import { CAR, scriptedControl, selectedText } from '../support/car';
import { serviceLogs } from '../support/e2e-stack';
import { expectNoForeignOrigin } from '../support/page-checks';

// US-5.7 (T5.7.4, L4) against the Compose stack: what holds across every page once a car is selected. No cookie
// is set and nothing leaves the origin (AC 55, the one cookie sweep of the public site), and the slug is in no
// application log (AC 56). Search engines, the options route and the click-out are lower levels or journey J7.

const PRODUCT = `/producto/${DEMO_SHARED.slug}`;

const withParam = (path: string, value: string): string => `${path}${path.includes('?') ? '&' : '?'}coche=${value}`;

test.describe('no cookie (AC 55)', () => {
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
});

// AC 56, in the pattern of search-privacy.spec.ts: the app container's output holds no slug.
test.describe('the selected slug is in no application log (AC 56)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  const marker = `zq${[...randomBytes(10)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('')}`;

  const logs = (): string => serviceLogs('app');

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
