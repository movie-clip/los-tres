import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { CAR, engineDetail, enginesOf, makesOf, modelsOf, selectedText } from '../support/car';
import { aria, expectSmoke } from '../support/smoke';

// US-5.7 ACs 9 to 17 and 38 against the Compose stack, journey J5 of 0006 rule 12: the picker as GET steps on
// /mi-coche, with JavaScript off (the page is a server page; the form presses are plain GET submits). The
// pure `volver` table is a unit test, car-picker.test.ts.

const PICKER = '/mi-coche';
const years = (from: number, to: number | null): string =>
  to === null
    ? messages.CarPicker.yearsOngoing.replace('{from}', String(from))
    : messages.CarPicker.years.replace('{from}', String(from)).replace('{to}', String(to));

const prompt = (page: Page) => page.getByTestId('car-picker-prompt');
const options = (page: Page) => page.getByTestId('car-picker-option');
const optionTexts = async (page: Page) =>
  (await options(page).allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim());

test.describe('the picker page, JavaScript off (ACs 9 to 17)', () => {
  test.use({ javaScriptEnabled: false });

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
});

// #339 (0006 rule 11): the smoke test of the car picker page family.
// It runs with JavaScript on; the same page without script is journey J5 above.
test.describe('car picker smoke (#339)', () => {
  test('S5 smoke: the picker page answers 200, its main region matches and the console is clean', async ({ page }) => {
    const [first, second] = makesOf();
    await expectSmoke(
      page,
      PICKER,
      aria`
        - heading "${messages.CarPicker.title}" [level=1]
        - paragraph: ${messages.CarPicker.stepCounter.replace('{step}', '1').replace('{total}', '3')}
        - heading "${messages.CarPicker.makeHeading}" [level=2]
        - list "${messages.CarPicker.makeHeading}":
          - listitem:
            - button "${first.label}"
          - listitem:
            - button "${second.label}"
        - link "${messages.CarPicker.cancel}":
          - /url: /
      `,
    );
  });
});
