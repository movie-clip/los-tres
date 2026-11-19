import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED } from '../fixtures/demo';
import { CAR, scriptedControl } from '../support/car';

// Issue #299, F1 to F4 (01-ux.md § Checks): geometry pins for the four public display fixes.
// F1 the car dialog keeps one panel height and one "Cerrar" position across its three steps;
// F2 the header field has the placeholder, the accessible name is unchanged;
// F3 the home h1 uses the title size at 14rem and below; F4 a 1px divider above every listing
// group after the first from 40rem, none on the phone.

const dialog = (page: Page) => page.getByRole('dialog', { name: messages.CarPicker.title });
const step = (page: Page) => dialog(page).getByTestId('car-picker-step');
const options = (page: Page) => dialog(page).getByTestId('car-picker-option');

async function geometry(page: Page): Promise<{ height: number; closeY: number }> {
  const panel = await dialog(page).boundingBox();
  const close = await dialog(page).getByTestId('car-dialog-close').boundingBox();
  return { height: panel!.height, closeY: close!.y };
}

for (const [width, height] of [
  [1280, 800],
  [1280, 600],
] as const) {
  test.describe(`F1: the car dialog at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the panel height and the Cerrar position are the same at all three steps', async ({ page }) => {
      await page.goto('/');
      await scriptedControl(page, false);
      await page.getByTestId('car-select').click();
      await expect(step(page)).toHaveAttribute('data-step', '1');
      const one = await geometry(page);

      await options(page).filter({ hasText: CAR.make }).first().click();
      await expect(step(page)).toHaveAttribute('data-step', '2');
      const two = await geometry(page);

      await options(page).filter({ hasText: `${CAR.model} ${CAR.generation}` }).first().click();
      await expect(step(page)).toHaveAttribute('data-step', '3');
      const three = await geometry(page);

      expect(two.height).toBeCloseTo(one.height, 0);
      expect(three.height).toBeCloseTo(one.height, 0);
      expect(two.closeY).toBeCloseTo(one.closeY, 0);
      expect(three.closeY).toBeCloseTo(one.closeY, 0);
      // The value, not only equality: min(44rem, viewport minus 2 x space-4), 704 and 504 here.
      expect(one.height).toBeCloseTo(Math.min(704, height - 96), 0);
      expect(three.height).toBeCloseTo(Math.min(704, height - 96), 0);
    });
  });
}

test.describe('F2: the header search placeholder', () => {
  test('the header field says "Buscar" and keeps its accessible name; the hero and page fields have none', async ({
    page,
  }) => {
    await page.goto(`/producto/${DEMO_SHARED.slug}`);
    const input = page.getByTestId('header-search-input');
    await expect(input).toHaveAttribute('placeholder', 'Buscar');
    await expect(input).toHaveAttribute('placeholder', messages.Search.headerPlaceholder);
    await expect(input).toHaveAttribute('aria-label', messages.Search.fieldLabel);
    await expect(page.getByRole('searchbox', { name: messages.Search.fieldLabel })).toHaveCount(1);

    await page.goto('/');
    await expect(page.getByTestId('home-search-input')).not.toHaveAttribute('placeholder', /.*/);
    await page.goto('/buscar?q=filtro');
    await expect(page.getByTestId('search-input')).not.toHaveAttribute('placeholder', /.*/);
  });
});

// The visible fit of the word "Buscar" depends on the platform font, so it is a ux-review check,
// not a gate pin. The gate pins the mechanism (the tighter field padding inside max-width 22.5rem),
// the 64px height and the placeholder, none of which depend on the font.
test.describe('F2 check 8: the header field padding at 352 to 361 px', () => {
  for (const [width, padding] of [
    [352, '8px'],
    [360, '8px'],
    [361, '16px'],
  ] as const) {
    test(`at ${width}px the header field has ${padding} side padding`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/categoria/aceite-de-motor');
      const input = page.getByTestId('header-search-input');
      await expect(input).toHaveAttribute('placeholder', 'Buscar');
      const sides = await input.evaluate((node) => {
        const style = getComputedStyle(node);
        return { left: style.paddingLeft, right: style.paddingRight };
      });
      expect(sides).toEqual({ left: padding, right: padding });
    });
  }

  for (const width of [352, 353, 360]) {
    test(`at ${width}px the header stays 64px tall`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/categoria/aceite-de-motor');
      await expect(page.getByTestId('header-search-input')).toHaveAttribute('placeholder', 'Buscar');
      const header = await page.locator('header').first().boundingBox();
      expect(header!.height).toBeCloseTo(64, 0);
    });
  }
});

test.describe('F3: the home h1 at 14rem and below', () => {
  for (const [width, size] of [
    [195, 24],
    [224, 24],
    [240, 32],
  ] as const) {
    for (const query of ['', '?coche=no-existe']) {
      test(`${width}px wide${query ? ' with an unknown car' : ''}: the h1 is ${size}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 422 });
        await page.goto(`/${query}`);
        const h1 = page.locator('main h1');
        await expect(h1).toHaveCount(1);
        const fontSize = await h1.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        expect(fontSize).toBe(size);
      });
    }
  }
});

test.describe('F4: the divider above listing groups after the first', () => {
  const topBorder = (page: Page, index: number) =>
    page
      .getByTestId('listing-group')
      .nth(index)
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return { width: parseFloat(style.borderTopWidth), color: style.borderTopColor };
      });
  // --color-border as the browser computes it: a probe element resolves the token in the page.
  const tokenColour = (page: Page) =>
    page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-border)';
      document.body.appendChild(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });

  for (const [width, expected] of [
    [1280, 1],
    [768, 1],
    [390, 0],
  ] as const) {
    test(`at ${width}px the second group has a ${expected}px top border and the first has none`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/categoria/mantenimiento-del-coche?coche=${CAR.slug}`);
      await expect(page.getByTestId('listing-group')).toHaveCount(2);
      expect((await topBorder(page, 0)).width).toBe(0);
      const second = await topBorder(page, 1);
      expect(second.width).toBe(expected);
      if (expected > 0) expect(second.color).toBe(await tokenColour(page));
    });
  }
});
