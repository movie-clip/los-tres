import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import {
  CAR,
  CAR_STORAGE_KEY,
  OTHER_MAKE,
  SAME_MODEL,
  UNKNOWN_SLUG,
  cocheValues,
  scriptedControl,
  seedStorage,
  selectedText,
  storageOf,
} from '../support/car';

// US-5.7 ACs 31 to 38, 42 and 55 against the Compose stack: the choice on the device under the
// localStorage key "mi-coche" (D-21). Written by the picker only, restored on a page opened without
// coche, cleared by Quitar; opening a URL with coche never writes it (D-8). Storage is read and
// seeded through page.evaluate and an init script; "throwing storage" replaces the Storage methods.

const dialog = (page: Page) => page.getByRole('dialog', { name: messages.CarPicker.title });
const options = (page: Page) => dialog(page).getByTestId('car-picker-option');
const label = (page: Page) => page.getByTestId('car-label');
const historyLength = (page: Page) => page.evaluate(() => window.history.length);

async function pickInDialog(page: Page, entry: typeof CAR): Promise<void> {
  await options(page).filter({ hasText: entry.make }).first().click();
  await options(page).filter({ hasText: `${entry.model} ${entry.generation}` }).first().click();
  await options(page).filter({ hasText: entry.engine }).first().click();
}

test.describe('writing the choice (AC 31, 55)', () => {
  test('AC 31: a dialog selection stores the slug and only the slug under mi-coche; no cookie, nothing else stored', async ({ page, context }) => {
    const responses: { url: string; setCookie: string | undefined }[] = [];
    const requested: string[] = [];
    page.on('response', (response) => {
      responses.push({ url: response.url(), setCookie: response.headers()['set-cookie'] });
    });
    page.on('request', (request) => requested.push(request.url()));

    await page.goto('/categoria/mantenimiento-del-coche');
    await scriptedControl(page, false);
    expect(await storageOf(page)).toEqual({});
    await page.getByTestId('car-select').click();
    await pickInDialog(page, CAR);
    await expect(label(page)).toHaveText(selectedText(CAR));

    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });
    expect(await page.evaluate(() => window.sessionStorage.getItem('mi-coche'))).toBeNull();
    // Browsing on afterwards: still no cookie, nothing leaves the origin (AC 55).
    await page.getByTestId('site-header-link').click();
    await page.waitForLoadState('networkidle');
    expect(await context.cookies()).toEqual([]);
    expect(responses.filter((item) => item.setCookie !== undefined)).toEqual([]);
    const origin = new URL(page.url()).origin;
    expect(requested.filter((url) => !url.startsWith('data:') && new URL(url).origin !== origin)).toEqual([]);
    expect((await context.storageState()).origins.flatMap((o) => o.localStorage.map((e) => e.name))).toEqual([CAR_STORAGE_KEY]);
  });

  test('AC 31: the final press on the /mi-coche page stores the car before it submits; a make or model press stores nothing', async ({ page }) => {
    await page.goto(`/mi-coche?volver=${encodeURIComponent('/buscar?q=filtro')}`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('car-picker-option').filter({ hasText: CAR.make }).first().click();
    await page.waitForURL((url) => url.searchParams.has('marca'));
    expect(await storageOf(page)).toEqual({});
    await page.getByTestId('car-picker-option').filter({ hasText: `${CAR.model} ${CAR.generation}` }).first().click();
    await page.waitForURL((url) => url.searchParams.has('modelo'));
    expect(await storageOf(page)).toEqual({});
    await page.getByTestId('car-picker-option').filter({ hasText: CAR.engine }).first().click();
    await page.waitForURL((url) => url.pathname === '/buscar');
    expect(new URL(page.url()).search).toBe(`?q=filtro&coche=${CAR.slug}`);
    await expect(label(page)).toHaveText(selectedText(CAR));
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });
  });

  test('AC 55: the picker page and its redirect set no cookie, a browser cookie jar stays empty', async ({ page, context }) => {
    await page.goto('/mi-coche');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('car-picker-option').filter({ hasText: CAR.make }).first().click();
    await page.waitForURL((url) => url.searchParams.has('marca'));
    expect(await context.cookies()).toEqual([]);
  });
});

test.describe('restoring the choice (AC 32, 33)', () => {
  test('AC 32, 33: a page opened without coche, with a stored car, ends at the same URL plus coche, with no history entry, query and fragment kept', async ({ browser, baseURL }) => {
    // Control: the same page opened with coche already in it, where nothing is restored.
    const controlContext = await browser.newContext({ baseURL });
    const control = await controlContext.newPage();
    await control.goto(`/buscar?q=filtro&coche=${CAR.slug}#resultados`);
    await expect(label(control)).toBeVisible();
    await control.waitForLoadState('networkidle');
    const expected = await historyLength(control);
    await controlContext.close();

    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await seedStorage(page, CAR.slug);
    await page.goto('/buscar?q=filtro#resultados');
    await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
    const url = new URL(page.url());
    expect(url.pathname + url.search + url.hash).toBe(`/buscar?q=filtro&coche=${CAR.slug}#resultados`);
    await expect(label(page)).toHaveText(selectedText(CAR));
    expect(await historyLength(page)).toBe(expected);
    // Going back leaves the site: the restore added no entry.
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    // Restoring is not a write: the stored value is unchanged.
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });
    expect(await context.cookies()).toEqual([]);
    await context.close();
  });

  for (const [name, path] of [
    ['home', '/'],
    ['product', '/producto/demo-filtro-de-aceite-oc-1234'],
    ['legal page', '/como-nos-financiamos'],
    ['search results', '/buscar?q=filtro'],
  ] as const) {
    test(`AC 32: ${name} restores the stored car`, async ({ page }) => {
      await seedStorage(page, CAR.slug);
      await page.goto(path);
      await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
      await expect(label(page)).toHaveText(selectedText(CAR));
    });
  }

  test('AC 5, 32, 33: the 404 page restores the stored car and shows it, status still 404', async ({ page }) => {
    await seedStorage(page, CAR.slug);
    await page.goto('/esta-pagina-no-existe');
    await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
    expect(new URL(page.url()).pathname).toBe('/esta-pagina-no-existe');
    await expect(label(page)).toHaveText(selectedText(CAR));
    const response = await page.reload();
    expect(response?.status()).toBe(404);
  });

  test('AC 5: the 404 page with no stored car shows the no-car state and raises no error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/esta-pagina-no-existe');
    await scriptedControl(page, false);
    await expect(page.getByTestId('car-select')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('AC 32: the restore does not loop: after it the address carries coche and the page settles', async ({ page }) => {
    let documents = 0;
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents += 1;
    });
    await seedStorage(page, CAR.slug);
    await page.goto('/');
    await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
    await expect(label(page)).toBeVisible();
    await page.waitForTimeout(1000);
    expect(documents).toBeLessThanOrEqual(2);
  });

  test('the /mi-coche page itself is never restored onto', async ({ page }) => {
    await seedStorage(page, CAR.slug);
    await page.goto('/mi-coche');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    expect(cocheValues(page.url())).toEqual([]);
  });
});

test.describe('removing the choice (AC 34)', () => {
  test('AC 34: Quitar clears mi-coche, removes coche from the URL keeping the other parameters, and the header returns to no car', async ({ page }) => {
    await seedStorage(page, CAR.slug);
    await page.goto('/buscar?q=filtro');
    await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
    await scriptedControl(page, true);
    await page.getByTestId('car-remove').click();
    await page.waitForURL((url) => !url.searchParams.has('coche'));
    expect(new URL(page.url()).search).toBe('?q=filtro');
    await expect(page.getByTestId('car-select')).toBeVisible();
    await expect(label(page)).toHaveCount(0);
    expect(await storageOf(page)).toEqual({});
    // And it stays removed: a reload does not bring the car back.
    await page.reload();
    await scriptedControl(page, false);
    await page.waitForTimeout(500);
    expect(cocheValues(page.url())).toEqual([]);
    await expect(page.getByTestId('car-select')).toBeVisible();
  });

  test('AC 34: removing keeps only what is stored for the other key', async ({ page }) => {
    await page.goto(`/?coche=${CAR.slug}`);
    await page.evaluate(([key, slug]) => {
      window.localStorage.setItem(key, slug);
      window.localStorage.setItem('otra-clave', 'valor');
    }, [CAR_STORAGE_KEY, CAR.slug]);
    await scriptedControl(page, true);
    await page.getByTestId('car-remove').click();
    await page.waitForURL((url) => !url.searchParams.has('coche'));
    expect(await storageOf(page)).toEqual({ 'otra-clave': 'valor' });
  });
});

test.describe('a stored value that is not a slug (AC 35)', () => {
  const BAD = [
    'Mi Coche!',
    '../../etc/passwd',
    '<script>alert(1)</script>',
    'UPPER-CASE',
    'trailing-',
    'a'.repeat(200),
    '',
    'http://evil.example/',
  ];
  for (const value of BAD) {
    test(`AC 35: stored ${JSON.stringify(value.slice(0, 30))} is cleared and never added to the URL`, async ({ page }) => {
      await seedStorage(page, value);
      await page.goto('/buscar?q=filtro');
      await scriptedControl(page, false);
      await expect.poll(() => storageOf(page)).toEqual({});
      await page.waitForTimeout(300);
      expect(new URL(page.url()).search).toBe('?q=filtro');
      await expect(page.getByTestId('car-select')).toBeVisible();
    });
  }
});

test.describe('storage that is unavailable or throws (AC 36)', () => {
  const THROWING: [string, string][] = [
    [
      'every Storage method throws',
      `for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
         Storage.prototype[name] = function () { throw new DOMException('denied', 'SecurityError'); };
       }`,
    ],
    [
      'reading window.localStorage itself throws',
      `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });`,
    ],
  ];

  for (const [name, script] of THROWING) {
    test(`AC 36: ${name}: pages still work, no uncaught error, the picker selects through the URL`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(script);

      await page.goto('/buscar?q=filtro');
      await scriptedControl(page, false);
      await expect(page.getByTestId('car-select')).toBeVisible();
      await page.getByTestId('car-select').click();
      await pickInDialog(page, CAR);
      await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
      expect(new URL(page.url()).search).toBe(`?q=filtro&coche=${CAR.slug}`);
      await expect(label(page)).toHaveText(selectedText(CAR));
      await expect(label(page)).toBeFocused();

      // Quitar still follows its link, with nothing to clear.
      await scriptedControl(page, true);
      await page.getByTestId('car-remove').click();
      await page.waitForURL((url) => !url.searchParams.has('coche'));
      await expect(page.getByTestId('car-select')).toBeVisible();

      // An unknown car opens fine and the notice shows.
      await page.goto(`/?coche=${UNKNOWN_SLUG}`);
      await expect(page.getByTestId('car-notice')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('AC 36: the /mi-coche final press goes through with throwing storage', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(THROWING[0][1]);
    await page.goto(`/mi-coche?marca=${CAR.makeSlug}&modelo=${CAR.modelSlug}`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('car-picker-option').filter({ hasText: CAR.engine }).first().click();
    await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
    await expect(label(page)).toHaveText(selectedText(CAR));
    expect(errors).toEqual([]);
  });
});

test.describe('opening a URL never writes the stored car (AC 37, D-8)', () => {
  test('AC 37: a URL with coche leaves an empty store empty', async ({ page }) => {
    await page.goto(`/?coche=${CAR.slug}`);
    await scriptedControl(page, true);
    await page.waitForTimeout(300);
    expect(await storageOf(page)).toEqual({});
  });

  test('AC 37, D-8: a shared link with another car shows that car and keeps the stored one', async ({ page }) => {
    await seedStorage(page, CAR.slug);
    await page.goto(`/buscar?q=filtro&coche=${OTHER_MAKE.slug}`);
    await expect(label(page)).toHaveText(selectedText(OTHER_MAKE));
    await scriptedControl(page, true);
    await page.waitForTimeout(300);
    expect(new URL(page.url()).search).toBe(`?q=filtro&coche=${OTHER_MAKE.slug}`);
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });
    // A later visit without coche restores the saved car, not the shared one.
    await page.goto('/buscar?q=filtro');
    await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
    await expect(label(page)).toHaveText(selectedText(CAR));
  });
});

test.describe('an unknown car and the stored value (AC 42, D-8)', () => {
  test('AC 42: the stored value that is the very unrecognised one is cleared, no car is restored', async ({ page }) => {
    await seedStorage(page, UNKNOWN_SLUG);
    await page.goto(`/?coche=${UNKNOWN_SLUG}`);
    await expect(page.getByTestId('car-notice')).toBeVisible();
    await expect.poll(() => storageOf(page)).toEqual({});
    expect(new URL(page.url()).searchParams.get('coche')).toBe(UNKNOWN_SLUG);
    await expect(page.getByTestId('car-select')).toBeVisible();
    // Next visit without coche: nothing to restore.
    await page.goto('/');
    await scriptedControl(page, false);
    await page.waitForTimeout(300);
    expect(cocheValues(page.url())).toEqual([]);
  });

  test('AC 42: a different valid stored car is left alone', async ({ page }) => {
    await seedStorage(page, CAR.slug);
    await page.goto(`/?coche=${UNKNOWN_SLUG}`);
    await expect(page.getByTestId('car-notice')).toBeVisible();
    await scriptedControl(page, false);
    await page.waitForTimeout(300);
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });
    // The page renders as without a car: no restore happens on a page that was opened with coche.
    expect(new URL(page.url()).searchParams.get('coche')).toBe(UNKNOWN_SLUG);
  });

  test('AC 42: a different unknown stored value is left alone', async ({ page }) => {
    await seedStorage(page, 'otro-coche-desconocido');
    await page.goto(`/?coche=${UNKNOWN_SLUG}`);
    await expect(page.getByTestId('car-notice')).toBeVisible();
    await scriptedControl(page, false);
    await page.waitForTimeout(300);
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: 'otro-coche-desconocido' });
  });

  test('AC 42: a malformed coche in the address clears nothing', async ({ page }) => {
    await seedStorage(page, CAR.slug);
    await page.goto('/?coche=Mal%20Formado%21');
    await expect(page.getByTestId('car-notice')).toBeVisible();
    await scriptedControl(page, false);
    await page.waitForTimeout(300);
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });
  });
});

test.describe('history after a selection (AC 30, 32, R2)', () => {
  test('a dialog selection replaces the history entry: history.length is the same after as before', async ({ page }) => {
    await page.goto('/categoria/mantenimiento-del-coche');
    await scriptedControl(page, false);
    await page.waitForLoadState('networkidle');
    const before = await historyLength(page);
    await page.getByTestId('car-select').click();
    await pickInDialog(page, CAR);
    await expect(label(page)).toHaveText(selectedText(CAR));
    await page.waitForLoadState('networkidle');
    expect(await historyLength(page)).toBe(before);
    const state = await page.evaluate(() => window.history.state as Record<string, unknown> | null);
    expect(state === null ? false : 'carFocus' in state).toBe(false);
  });

  test('changing the car replaces again: still the same history.length', async ({ page }) => {
    await page.goto(`/?coche=${CAR.slug}`);
    await scriptedControl(page, true);
    await page.waitForLoadState('networkidle');
    const before = await historyLength(page);
    await page.getByTestId('car-change').click();
    await options(page).filter({ hasText: SAME_MODEL.engine }).first().click();
    await expect(label(page)).toHaveText(selectedText(SAME_MODEL));
    await page.waitForLoadState('networkidle');
    expect(await historyLength(page)).toBe(before);
  });

  test('a reload of the selected page keeps the car and does not move focus onto the label again', async ({ page }) => {
    await page.goto('/');
    await scriptedControl(page, false);
    await page.getByTestId('car-select').click();
    await pickInDialog(page, CAR);
    await expect(label(page)).toBeFocused();
    await page.reload();
    await expect(label(page)).toHaveText(selectedText(CAR));
    await expect(label(page)).not.toBeFocused();
  });
});
