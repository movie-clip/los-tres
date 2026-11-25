import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import {
  CAR,
  carName,
  cocheValues,
  enginesOf,
  fitCountsLine,
  makesOf,
  modelsOf,
  selectedText,
  storageOf,
} from '../support/car';

// US-5.7 ACs 7, 23 to 30 against the Compose stack, with JavaScript: the picker as a native modal dialog on the
// current page. Every selection is a full document load (D-19), so after a pick the assertions wait for the
// label, not for a client navigation.

// #339 (0006 rule 12): journey J4, car selection in the dialog by mouse and by keyboard, then the listing for that
// car. Elements are found by role and accessible name; the dialog's step controls
// are buttons, and the no-car control is a link until the page hydrates and a button after, so asking for the
// button is also the wait for script.
test.describe('car selection journey (#339)', () => {
  const ROOT_CATEGORY = '/categoria/mantenimiento-del-coche';
  /** The root category with CAR on the demo data: fits, no data, hidden non-fits (04-ux of S5.8), over two pages. */
  const ROOT_WITH_CAR = { fits: 10, unknown: 23, leftOut: 17 };
  const ROOT_WITH_CAR_PAGES = 2;

  const picker = (page: Page) => page.getByRole('dialog', { name: messages.CarPicker.title });
  const carGroup = (page: Page) => page.getByRole('group', { name: messages.Car.groupLabel });
  /** A button whose accessible name starts with `text` (an option's name carries a second line of detail). */
  const startingWith = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

  test('J4: by mouse, from the no-car control through three steps to the listing for that car', async ({ page, context }) => {
    await page.goto(ROOT_CATEGORY);
    await page.getByRole('button', { name: messages.Car.select }).click();
    await expect(picker(page)).toBeVisible();
    await picker(page).getByRole('button', { name: CAR.make, exact: true }).click();
    await picker(page).getByRole('button', { name: startingWith(`${CAR.model} ${CAR.generation}`) }).click();
    await picker(page).getByRole('button', { name: startingWith(CAR.engine) }).click();

    // The same page reloads with the car: the header names it, and the address carries it once, last.
    await expect(carGroup(page)).toContainText(selectedText(CAR));
    await expect(picker(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(ROOT_CATEGORY);
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    expect(await context.cookies()).toEqual([]);

    // The listing for that car: the compatible products first, each marked, then those with no data, and the counts line.
    const fitsHeading = messages.Fit.fitsHeading.replace('{car}', carName(CAR));
    await expect(page.getByRole('heading', { level: 2, name: fitsHeading })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: messages.Fit.unknownHeading })).toBeVisible();
    await expect(
      page.getByRole('region', { name: fitsHeading }).getByText(messages.Fit.markFits, { exact: true }),
    ).toHaveCount(ROOT_WITH_CAR.fits);
    await expect(page.getByText(fitCountsLine(ROOT_WITH_CAR, [1, ROOT_WITH_CAR_PAGES]), { exact: true })).toBeVisible();
  });

  test('J4: by keyboard, Escape closes the dialog and returns focus, then three steps end with the car selected', async ({
    page,
  }) => {
    await page.goto(ROOT_CATEGORY);
    const select = page.getByRole('button', { name: messages.Car.select });
    await select.focus();
    await page.keyboard.press('Enter');
    await expect(picker(page)).toBeVisible();

    // Escape closes it, changes nothing and gives focus back to the control that opened it.
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(select).toBeFocused();
    expect(await storageOf(page)).toEqual({});

    // Open it again and finish with the keyboard alone. Focus starts on each step's prompt; Tab reaches the
    // first option, and on steps 2 and 3 Shift+Tab reaches the back action before it.
    const make = makesOf()[0];
    const model = modelsOf(make.slug)[0];
    const engine = enginesOf(model.slug)[0];
    await page.keyboard.press('Enter');
    await expect(picker(page).getByRole('heading', { level: 3, name: messages.CarPicker.makeHeading })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(picker(page).getByRole('button', { name: make.label, exact: true })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(
      picker(page).getByRole('heading', { level: 3, name: messages.CarPicker.modelHeading.replace('{make}', make.label) }),
    ).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(picker(page).getByRole('button', { name: messages.CarPicker.backToMakes })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(picker(page).getByRole('button', { name: startingWith(model.label) })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(
      picker(page).getByRole('heading', {
        level: 3,
        name: messages.CarPicker.engineHeading.replace('{model}', `${make.label} ${model.label}`),
      }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(picker(page).getByRole('button', { name: startingWith(engine.engine) })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(carGroup(page)).toContainText(selectedText(engine));
    expect(cocheValues(page.url())).toEqual([engine.slug]);
  });
});
