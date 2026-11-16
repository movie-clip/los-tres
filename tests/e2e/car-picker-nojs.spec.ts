import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import {
  CAR,
  OTHER_MAKE,
  SAME_MODEL,
  UNKNOWN_SLUG,
  cocheValues,
  engineDetail,
  enginesOf,
  makesOf,
  modelsOf,
  selectedText,
} from '../support/car';

// US-5.7 ACs 7 to 22 and 38 against the Compose stack: the picker as GET steps on /mi-coche,
// with JavaScript off (the page is a server page; the form presses are plain GET submits). The
// pure `volver` table is a unit test; here the hostile values are sent to the real route.

const PICKER = '/mi-coche';
const years = (from: number, to: number | null): string =>
  to === null
    ? messages.CarPicker.yearsOngoing.replace('{from}', String(from))
    : messages.CarPicker.years.replace('{from}', String(from)).replace('{to}', String(to));

const prompt = (page: Page) => page.getByTestId('car-picker-prompt');
const options = (page: Page) => page.getByTestId('car-picker-option');
const optionTexts = async (page: Page) =>
  (await options(page).allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim());

test.describe('the picker page, JavaScript off (ACs 7 to 21)', () => {
  test.use({ javaScriptEnabled: false });

  test('AC 14, 8, 12: the no-car action is a link to the make step, listing every make in list order', async ({ page, context }) => {
    await page.goto('/');
    const select = page.getByTestId('car-select');
    await expect(select).toHaveText(messages.Car.select);
    expect(await select.getAttribute('href')).toBe(`${PICKER}?volver=%2F`);
    await select.click();
    await page.waitForURL((url) => url.pathname === PICKER);

    await expect(page.getByTestId('car-picker-step')).toHaveAttribute('data-step', '1');
    await expect(prompt(page)).toHaveText(messages.CarPicker.makeHeading);
    await expect(page.getByText(messages.CarPicker.stepCounter.replace('{step}', '1').replace('{total}', '3'))).toBeVisible();
    expect(await optionTexts(page)).toEqual(makesOf().map((make) => make.label));
    // Step 1 has no back action; the page is not the dialog and not indexable (AC 22).
    await expect(page.getByTestId('car-picker-back')).toHaveCount(0);
    await expect(page.getByTestId('car-picker-cancel')).toHaveText(messages.CarPicker.cancel);
    expect(await page.getByTestId('car-picker-cancel').getAttribute('href')).toBe('/');
    expect(await context.cookies()).toEqual([]);
  });

  test('ACs 9, 10, 13, 16, 17: make, model, engine as three GET steps, then back to the page with the car', async ({ page, context }) => {
    await page.goto(`${PICKER}?volver=${encodeURIComponent('/buscar?q=filtro')}`);

    await options(page).filter({ hasText: CAR.make }).first().click();
    await page.waitForURL((url) => url.searchParams.get('marca') === CAR.makeSlug);
    expect(new URL(page.url()).searchParams.get('volver')).toBe('/buscar?q=filtro');
    await expect(page.getByTestId('car-picker-step')).toHaveAttribute('data-step', '2');
    await expect(prompt(page)).toHaveText(messages.CarPicker.modelHeading.replace('{make}', CAR.make));
    // Only the chosen make's models, each with its generation and years (AC 9).
    const models = modelsOf(CAR.makeSlug);
    const modelRows = await optionTexts(page);
    expect(modelRows).toHaveLength(models.length);
    models.forEach((model, index) => {
      const entry = enginesOf(model.slug)[0];
      expect(modelRows[index]).toContain(model.label);
      const span = enginesOf(model.slug);
      const from = Math.min(...span.map((item) => item.yearFrom));
      const ends = span.map((item) => item.yearTo);
      const to = ends.includes(null) ? null : Math.max(...(ends as number[]));
      expect(modelRows[index]).toContain(years(from, to));
      expect(entry.makeSlug).toBe(CAR.makeSlug);
    });

    await options(page).filter({ hasText: `${CAR.model} ${CAR.generation}` }).first().click();
    await page.waitForURL((url) => url.searchParams.get('modelo') === CAR.modelSlug);
    await expect(page.getByTestId('car-picker-step')).toHaveAttribute('data-step', '3');
    await expect(prompt(page)).toHaveText(
      messages.CarPicker.engineHeading.replace('{model}', `${CAR.make} ${CAR.model} ${CAR.generation}`),
    );
    // Only the chosen model's engines, with fuel and power (AC 10).
    const engines = enginesOf(CAR.modelSlug);
    const engineRows = await optionTexts(page);
    expect(engineRows).toHaveLength(engines.length);
    engines.forEach((engine, index) => {
      expect(engineRows[index]).toContain(engine.engine);
      expect(engineRows[index]).toContain(engineDetail(engine));
    });

    await options(page).filter({ hasText: CAR.engine }).first().click();
    // AC 13, 17: exactly that vehicle, back on the page the visitor came from, car in the header.
    await page.waitForURL((url) => url.pathname === '/buscar');
    expect(new URL(page.url()).search).toBe(`?q=filtro&coche=${CAR.slug}`);
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));
    expect(await context.cookies()).toEqual([]);
    // AC 38: without script nothing is stored.
    expect((await context.storageState()).origins).toEqual([]);
  });

  test('AC 8, 11: every make has at least one engine; a make with no fitment is still listed', async ({ page }) => {
    // The shipped list has no retired vehicle, so this pins that the listed makes are exactly the list's.
    await page.goto(PICKER);
    expect(await optionTexts(page)).toEqual(makesOf().map((make) => make.label));
    for (const make of makesOf()) {
      await page.goto(`${PICKER}?marca=${make.slug}`);
      expect((await optionTexts(page)).length).toBeGreaterThan(0);
    }
  });

  test('AC 15: the change action leads to the engine step of the current model, current row marked', async ({ page }) => {
    await page.goto(`/categoria/mantenimiento-del-coche?coche=${CAR.slug}`);
    const change = page.getByTestId('car-change');
    const href = (await change.getAttribute('href')) ?? '';
    const target = new URL(href, 'http://h.invalid');
    expect(target.pathname).toBe(PICKER);
    expect(target.searchParams.get('marca')).toBe(CAR.makeSlug);
    expect(target.searchParams.get('modelo')).toBe(CAR.modelSlug);
    await change.click();
    await page.waitForURL((url) => url.pathname === PICKER);
    await expect(page.getByTestId('car-picker-step')).toHaveAttribute('data-step', '3');
    // The current engine's row is the one marked as current.
    await expect(page.locator('[data-testid="car-picker-option"][aria-current="true"]')).toHaveCount(1);
    await expect(
      page.locator('[data-testid="car-picker-option"][aria-current="true"]'),
    ).toContainText(CAR.engine);
  });

  test('ACs 17, 20: changing the car keeps the other parameters and replaces coche, never adding a second', async ({ page }) => {
    await page.goto(`/buscar?q=filtro&coche=${CAR.slug}`);
    await page.getByTestId('car-change').click();
    await page.waitForURL((url) => url.pathname === PICKER);
    await options(page).filter({ hasText: SAME_MODEL.engine }).first().click();
    await page.waitForURL((url) => url.pathname === '/buscar');
    expect(cocheValues(page.url())).toEqual([SAME_MODEL.slug]);
    expect(new URL(page.url()).searchParams.get('q')).toBe('filtro');
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(SAME_MODEL));
  });

  test('AC 19, 20: a missing or empty volver lands on the home page with the car; a kept query keeps its parameters', async ({ request }) => {
    const done = `marca=${CAR.makeSlug}&modelo=${CAR.modelSlug}&coche=${CAR.slug}`;
    const locate = async (volver: string) => {
      const response = await request.get(`${PICKER}?${done}${volver}`, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers()['set-cookie']).toBeUndefined();
      return response.headers().location;
    };
    expect(await locate('')).toBe(`/?coche=${CAR.slug}`);
    expect(await locate('&volver=')).toBe(`/?coche=${CAR.slug}`);
    expect(await locate(`&volver=${encodeURIComponent('/categoria/mantenimiento-del-coche?orden=precio&pagina=2')}`)).toBe(
      `/categoria/mantenimiento-del-coche?orden=precio&pagina=2&coche=${CAR.slug}`,
    );
    // An existing coche in volver is replaced, not added to (AC 20).
    expect(await locate(`&volver=${encodeURIComponent(`/buscar?coche=${OTHER_MAKE.slug}&q=filtro`)}`)).toBe(
      `/buscar?q=filtro&coche=${CAR.slug}`,
    );
  });

  const HOSTILE: [string, string][] = [
    ['another origin', 'https://evil.example/'],
    ['a protocol-relative address', '//evil.example'],
    ['a protocol-relative address with a dot segment', '/.//evil.example'],
    ['a backslash form', '/\\evil.example'],
    ['a backslash after the first character', '/a\\evil.example'],
    ['a javascript scheme', 'javascript:alert(1)'],
    ['a data scheme', 'data:text/html,hi'],
    ['a control character', '/a\u0001b'],
    ['a space', '/a b'],
    ['a newline', '/a\nb'],
    ['over 512 characters', `/${'a'.repeat(600)}`],
    ['a relative path', 'categoria/x'],
    ['the picker itself', '/mi-coche'],
    ['the click redirect', '/go/1'],
    ['the admin area', '/admin'],
    ['the API', '/api/x'],
  ];
  for (const [name, value] of HOSTILE) {
    test(`AC 18: volver naming ${name} is not followed, the visitor lands on the home page`, async ({ request }) => {
      const response = await request.get(
        `${PICKER}?marca=${CAR.makeSlug}&modelo=${CAR.modelSlug}&coche=${CAR.slug}&volver=${encodeURIComponent(value)}`,
        { maxRedirects: 0 },
      );
      expect(response.status()).toBe(307);
      expect(response.headers().location).toBe(`/?coche=${CAR.slug}`);
    });
  }

  test('AC 18: a repeated volver is not followed', async ({ request }) => {
    const response = await request.get(
      `${PICKER}?marca=${CAR.makeSlug}&modelo=${CAR.modelSlug}&coche=${CAR.slug}&volver=%2Fa&volver=%2Fb`,
      { maxRedirects: 0 },
    );
    expect(response.headers().location).toBe(`/?coche=${CAR.slug}`);
  });

  test('AC 21: unknown or out-of-sequence input renders the earliest answerable step, no error, no car', async ({ request, page }) => {
    const wrongMake = OTHER_MAKE.makeSlug;
    const cases: [string, string, string][] = [
      ['an unknown make', 'marca=no-existe', '1'],
      ['a model of another make', `marca=${wrongMake}&modelo=${CAR.modelSlug}`, '2'],
      ['an unknown model', `marca=${CAR.makeSlug}&modelo=no-existe`, '2'],
      ['an engine of another model', `marca=${CAR.makeSlug}&modelo=${CAR.modelSlug}&coche=${OTHER_MAKE.slug}`, '3'],
      ['an unknown engine', `marca=${CAR.makeSlug}&modelo=${CAR.modelSlug}&coche=${UNKNOWN_SLUG}`, '3'],
      ['a model with no make', `modelo=${CAR.modelSlug}`, '1'],
      ['an engine with no make or model', `coche=${CAR.slug}`, '1'],
      ['a repeated make', `marca=${CAR.makeSlug}&marca=${wrongMake}`, '1'],
    ];
    for (const [name, query, step] of cases) {
      const response = await request.get(`${PICKER}?${query}`, { maxRedirects: 0 });
      expect(response.status(), name).toBe(200);
      await page.goto(`${PICKER}?${query}`);
      await expect(page.getByTestId('car-picker-step'), name).toHaveAttribute('data-step', step);
      await expect(page.getByTestId('public-error'), name).toHaveCount(0);
      await expect(page.getByTestId('car-label'), name).toHaveCount(0);
    }
  });

  test('AC 38, D-13: without script the remove action is a link to the same page without coche, other parameters kept', async ({ page }) => {
    await page.goto(`/buscar?q=filtro&coche=${CAR.slug}`);
    const remove = page.getByTestId('car-remove');
    expect(await remove.getAttribute('href')).toBe('/buscar?q=filtro');
    await remove.click();
    await page.waitForURL((url) => url.pathname === '/buscar' && !url.searchParams.has('coche'));
    expect(new URL(page.url()).search).toBe('?q=filtro');
    await expect(page.getByTestId('car-select')).toBeVisible();
    await expect(page.getByTestId('car-label')).toHaveCount(0);
  });

  test('AC 14: the no-script select link on a page with query parameters returns to that page', async ({ page }) => {
    await page.goto('/buscar?q=filtro');
    const href = (await page.getByTestId('car-select').getAttribute('href')) ?? '';
    expect(new URL(href, 'http://h.invalid').searchParams.get('volver')).toBe('/buscar?q=filtro');
  });
});

test.describe('the picker page, a response contract (ACs 6, 22, 55)', () => {
  test('AC 22: noindex, no canonical, same-origin referrer policy, disallowed in robots.txt', async ({ request, page }) => {
    for (const query of ['', `?marca=${CAR.makeSlug}`, `?marca=${CAR.makeSlug}&modelo=${CAR.modelSlug}`, `?coche=${CAR.slug}`]) {
      const response = await request.get(`${PICKER}${query}`, { maxRedirects: 0 });
      expect(response.status(), query).toBe(200);
      expect(response.headers()['referrer-policy'], query).toBe('same-origin');
      expect(response.headers()['set-cookie'], query).toBeUndefined();
    }
    await page.goto(PICKER);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page).toHaveTitle(messages.CarPicker.metaTitle.replace('{siteName}', (process.env.SITE_NAME ?? '').trim()));
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/^Disallow: \/mi-coche$/m);
  });

  test('AC 6, 55: the picker page draws no car control of its own, and the redirect sets no cookie', async ({ page, request }) => {
    await page.goto(PICKER);
    await expect(page.getByTestId('car-control')).toHaveCount(0);
    await expect(page.getByTestId('site-header-link')).toBeVisible();
    const done = await request.get(
      `${PICKER}?marca=${CAR.makeSlug}&modelo=${CAR.modelSlug}&coche=${CAR.slug}`,
      { maxRedirects: 0 },
    );
    expect(done.headers()['set-cookie']).toBeUndefined();
  });
});
