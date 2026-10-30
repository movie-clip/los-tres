import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import {
  CAR,
  CAR_STORAGE_KEY,
  OTHER_MAKE,
  SAME_MODEL,
  cocheValues,
  enginesOf,
  makesOf,
  modelsOf,
  scriptedControl,
  selectedText,
} from '../support/car';

// US-5.7 ACs 7, 23 to 30 against the Compose stack, with JavaScript: the picker as a native modal
// dialog on the current page. Every selection is a full document load (D-19), so after a pick the
// assertions wait for the label, not for a client navigation.

const dialog = (page: Page) => page.getByRole('dialog', { name: messages.CarPicker.title });
const step = (page: Page) => dialog(page).getByTestId('car-picker-step');
const prompt = (page: Page) => dialog(page).getByTestId('car-picker-prompt');
const options = (page: Page) => dialog(page).getByTestId('car-picker-option');

async function openFromNoCar(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await scriptedControl(page, false);
  await page.getByTestId('car-select').click();
  await expect(dialog(page)).toBeVisible();
}

test.describe('the dialog opens and is announced (ACs 23 to 25)', () => {
  test('AC 23, 24, 25, 7: the no-car action opens a modal dialog with a name, on the same page, focus inside, step 1 first', async ({ page, context }) => {
    await openFromNoCar(page, '/buscar?q=filtro');
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/buscar?q=filtro');
    await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
    expect(await dialog(page).evaluate((node) => (node as HTMLDialogElement).open)).toBe(true);
    await expect(dialog(page).getByRole('heading', { level: 2, name: messages.CarPicker.title })).toBeVisible();
    await expect(step(page)).toHaveAttribute('data-step', '1');
    await expect(prompt(page)).toHaveText(messages.CarPicker.makeHeading);
    // Focus moved into the dialog: on the prompt, the first thing a screen reader reads.
    await expect(prompt(page)).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true);
    // AC 7: step 1 lists the makes of the list in list order.
    expect((await options(page).allTextContents()).map((text) => text.trim())).toEqual(makesOf().map((m) => m.label));
    expect(await context.cookies()).toEqual([]);
  });

  test('AC 24: the make list is a list named by its prompt, the close button has an accessible name', async ({ page }) => {
    await openFromNoCar(page);
    await expect(dialog(page).getByRole('list', { name: messages.CarPicker.makeHeading })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: messages.CarPicker.closeLabel })).toBeVisible();
  });

  test('the page behind is inert while the dialog is open: Tab never leaves it', async ({ page }) => {
    await openFromNoCar(page);
    // From the prompt the makes are the only tab stops left (the close button precedes it); a Tab
    // past the last one leaves the document, which is the browser's modal behaviour.
    for (let i = 0; i < makesOf().length; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null), `Tab ${i + 1}`).toBe(true);
    }
    await expect(page.getByTestId('site-header-link')).not.toBeFocused();
  });

  test('AC 29: Cambiar opens the dialog at the engine step of the current model, current engine marked', async ({ page }) => {
    await page.goto(`/?coche=${CAR.slug}`);
    await scriptedControl(page, true);
    await page.getByTestId('car-change').click();
    await expect(dialog(page)).toBeVisible();
    await expect(step(page)).toHaveAttribute('data-step', '3');
    await expect(prompt(page)).toHaveText(
      messages.CarPicker.engineHeading.replace('{model}', `${CAR.make} ${CAR.model} ${CAR.generation}`),
    );
    await expect(prompt(page)).toBeFocused();
    await expect(options(page)).toHaveCount(enginesOf(CAR.modelSlug).length);
    const current = dialog(page).locator('[data-testid="car-picker-option"][aria-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText(CAR.engine);
  });
});

test.describe('three steps, by mouse and by keyboard (ACs 7, 13, 26, 30)', () => {
  test('ACs 9, 10, 13, 30: make, model, engine, then the same page reloads with coche last and other parameters kept', async ({ page }) => {
    await openFromNoCar(page, '/buscar?q=filtro&pagina=1');
    await options(page).filter({ hasText: CAR.make }).first().click();
    await expect(step(page)).toHaveAttribute('data-step', '2');
    await expect(prompt(page)).toBeFocused();
    expect((await options(page).allTextContents()).length).toBe(modelsOf(CAR.makeSlug).length);
    await options(page).filter({ hasText: `${CAR.model} ${CAR.generation}` }).first().click();
    await expect(step(page)).toHaveAttribute('data-step', '3');
    expect((await options(page).allTextContents()).length).toBe(enginesOf(CAR.modelSlug).length);
    await options(page).filter({ hasText: CAR.engine }).first().click();

    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));
    await expect(dialog(page)).toHaveCount(0);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/buscar');
    expect(url.search).toBe(`?q=filtro&pagina=1&coche=${CAR.slug}`);
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
  });

  test('the back actions return one step: models to makes, engines to models', async ({ page }) => {
    await openFromNoCar(page);
    await options(page).filter({ hasText: CAR.make }).first().click();
    await expect(step(page)).toHaveAttribute('data-step', '2');
    await expect(dialog(page).getByTestId('car-picker-back')).toHaveText(messages.CarPicker.backToMakes);
    await options(page).filter({ hasText: `${CAR.model} ${CAR.generation}` }).first().click();
    await expect(step(page)).toHaveAttribute('data-step', '3');
    await expect(dialog(page).getByTestId('car-picker-back')).toHaveText(messages.CarPicker.backToModels);
    await dialog(page).getByTestId('car-picker-back').click();
    await expect(step(page)).toHaveAttribute('data-step', '2');
    await dialog(page).getByTestId('car-picker-back').click();
    await expect(step(page)).toHaveAttribute('data-step', '1');
    await expect(dialog(page).getByTestId('car-picker-back')).toHaveCount(0);
  });

  test('AC 26: a keyboard alone opens the dialog, completes all three steps and ends with the car selected', async ({ page }) => {
    await page.goto('/categoria/mantenimiento-del-coche');
    await scriptedControl(page, false);
    await page.getByTestId('car-select').focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(step(page)).toHaveAttribute('data-step', '1');
    // From the prompt the first Tab reaches the first make; Enter presses it.
    await page.keyboard.press('Tab');
    await expect(options(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(step(page)).toHaveAttribute('data-step', '2');
    await expect(prompt(page)).toBeFocused();
    // The back action comes before the prompt in reading order: Shift+Tab reaches it, Tab the first model.
    await page.keyboard.press('Shift+Tab');
    await expect(dialog(page).getByTestId('car-picker-back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(options(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(step(page)).toHaveAttribute('data-step', '3');
    await page.keyboard.press('Tab');
    await expect(options(page).first()).toBeFocused();
    await page.keyboard.press('Enter');

    const first = makesOf()[0];
    const firstModel = modelsOf(first.slug)[0];
    const firstEngine = enginesOf(firstModel.slug)[0];
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(firstEngine));
    expect(cocheValues(page.url())).toEqual([firstEngine.slug]);
  });

  test('AC 26: a keyboard alone closes the dialog with the close button', async ({ page }) => {
    await openFromNoCar(page);
    await dialog(page).getByTestId('car-dialog-close').focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe('closing without a selection (ACs 27, 28)', () => {
  test('AC 27, 28: Escape closes the dialog, leaves the page, the URL and the storage unchanged, and focus returns to the opener', async ({ page }) => {
    await openFromNoCar(page, '/buscar?q=filtro');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('?q=filtro');
    await expect(page.getByTestId('car-select')).toBeFocused();
    await expect(page.getByTestId('car-label')).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('AC 27: Escape from step 3 changes nothing about the selected car', async ({ page }) => {
    await page.goto(`/?coche=${CAR.slug}`);
    await scriptedControl(page, true);
    await page.getByTestId('car-change').click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('coche')).toBe(CAR.slug);
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));
    // Focus goes back to the action that opened it (the change action).
    await expect(page.getByTestId('car-change')).toBeFocused();
  });

  test('AC 28: Cerrar and a press on the backdrop close it, focus on the opener', async ({ page }) => {
    await openFromNoCar(page);
    await dialog(page).getByTestId('car-dialog-close').click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId('car-select')).toBeFocused();

    await page.getByTestId('car-select').click();
    await expect(dialog(page)).toBeVisible();
    // The corner of the viewport is on the backdrop at 1280 px (a centred panel).
    await page.mouse.click(4, 4);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId('car-select')).toBeFocused();
  });

  test('a press that starts inside the panel and ends on the backdrop does not close it', async ({ page }) => {
    await openFromNoCar(page);
    const box = (await prompt(page).boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 2);
    await page.mouse.down();
    await page.mouse.move(4, 4);
    await page.mouse.up();
    await expect(dialog(page)).toBeVisible();
  });

  test('the dialog can be reopened after a close and starts again at step 1', async ({ page }) => {
    await openFromNoCar(page);
    await options(page).filter({ hasText: CAR.make }).first().click();
    await expect(step(page)).toHaveAttribute('data-step', '2');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await page.getByTestId('car-select').click();
    await expect(step(page)).toHaveAttribute('data-step', '1');
  });
});

test.describe('after a selection (AC 28, D-12, R1)', () => {
  test('AC 28: after a selection focus is on the car label, and the one-shot focus key is gone from history.state', async ({ page }) => {
    await openFromNoCar(page);
    await options(page).filter({ hasText: CAR.make }).first().click();
    await options(page).filter({ hasText: `${CAR.model} ${CAR.generation}` }).first().click();
    await options(page).filter({ hasText: CAR.engine }).first().click();
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));
    await expect(page.getByTestId('car-label')).toBeFocused();
    // R2: Next keeps its own state in history.state; the focus key is removed and the rest stays an object.
    const state = await page.evaluate(() => window.history.state as Record<string, unknown> | null);
    expect(state === null || typeof state === 'object').toBe(true);
    expect(state === null ? false : 'carFocus' in state).toBe(false);
  });

  test('D-12: changing the car through the dialog ends on the new car, focus on the label', async ({ page }) => {
    await page.goto(`/?coche=${CAR.slug}`);
    await scriptedControl(page, true);
    await page.getByTestId('car-change').click();
    await options(page).filter({ hasText: SAME_MODEL.engine }).first().click();
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(SAME_MODEL));
    await expect(page.getByTestId('car-label')).toBeFocused();
    expect(cocheValues(page.url())).toEqual([SAME_MODEL.slug]);
  });

  test('R1: select a car, then click the logo: the header is not stale, it shows the car the address agrees with', async ({ page }) => {
    await openFromNoCar(page, '/categoria/mantenimiento-del-coche');
    await options(page).filter({ hasText: CAR.make }).first().click();
    await options(page).filter({ hasText: `${CAR.model} ${CAR.generation}` }).first().click();
    await options(page).filter({ hasText: CAR.engine }).first().click();
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));

    await page.getByTestId('site-header-link').click();
    await page.waitForURL((url) => url.pathname === '/');
    // The logo is a plain link with no coche (link carrying is T5.7.5). Whatever the navigation
    // kind, the header must still name the stored car and never fall back to the no-car state.
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(CAR));
    await expect(page.getByTestId('car-select')).toHaveCount(0);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), CAR_STORAGE_KEY)).toBe(CAR.slug);
  });

  test('R1: select A, change to B, click the logo: the header shows B, never the stale A', async ({ page }) => {
    await page.goto(`/?coche=${CAR.slug}`);
    await scriptedControl(page, true);
    await page.getByTestId('car-change').click();
    await options(page).filter({ hasText: SAME_MODEL.engine }).first().click();
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(SAME_MODEL));

    await page.getByTestId('site-header-link').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(SAME_MODEL));
    await expect(page.getByTestId('car-label')).not.toHaveText(selectedText(CAR));
  });

  test('R1: select, then follow a category link and the footer: the header agrees with the stored car', async ({ page }) => {
    await page.goto('/');
    await scriptedControl(page, false);
    await page.getByTestId('car-select').click();
    await options(page).filter({ hasText: OTHER_MAKE.make }).first().click();
    await options(page).filter({ hasText: `${OTHER_MAKE.model} ${OTHER_MAKE.generation}` }).first().click();
    await options(page).filter({ hasText: OTHER_MAKE.engine }).first().click();
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(OTHER_MAKE));

    await page.getByTestId('category-tile-link').first().click();
    await page.waitForURL((url) => url.pathname.startsWith('/categoria/'));
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(OTHER_MAKE));
    await page.getByRole('contentinfo').getByRole('link').last().click();
    await page.waitForURL((url) => url.pathname === '/como-nos-financiamos');
    await expect(page.getByTestId('car-label')).toHaveText(selectedText(OTHER_MAKE));
  });
});
