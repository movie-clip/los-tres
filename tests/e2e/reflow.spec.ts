import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_CATEGORY_COUNTS, DEMO_FOUR_OFFERS, DEMO_LONG_TITLE } from '../fixtures/demo';
import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import { LONGEST_CAR, enginesOf, modelsOf, scriptedControl } from '../support/car';

// S11.7 (03-ux checks 24 and 25): the public pages reflow at 360 and at 195 CSS px (a 390 phone at
// 200% zoom), with no sideways scroll and no text hidden by an ancestor. The legal pages are left
// out: they answer 500 while the owner identity in .env is blank.

const ROOT = FIXED_CATEGORY_TREE.slug;
const PAGES: { name: string; url: string }[] = [
  { name: 'home', url: '/' },
  { name: 'root category', url: `/categoria/${ROOT}` },
  { name: 'air filters', url: '/categoria/filtros-de-aire' },
  { name: 'empty fuel category', url: '/categoria/filtros-de-combustible' },
  { name: 'four-offer product', url: `/producto/${DEMO_FOUR_OFFERS.slug}` },
  { name: '404', url: '/no-existe' },
  { name: 'nested 404', url: '/producto/no-existe' },
  // S5.4 (AC 27): the results page and its two empty states, and a 100-character term with no break.
  { name: 'search results', url: '/buscar?q=filtro' },
  { name: 'search results, page 2', url: '/buscar?q=filtro&pagina=2' },
  { name: 'search empty query', url: '/buscar' },
  { name: 'search no results', url: '/buscar?q=zqxvbnmw' },
  { name: 'search no results, 100-character term', url: `/buscar?q=${'w'.repeat(100)}` },
  { name: 'search past the last page', url: '/buscar?q=filtro&pagina=99' },
];

/** The href of the long-title demo product, found on the root listing pages. */
async function longTitleUrl(page: Page): Promise<string> {
  const pages = Math.ceil(DEMO_CATEGORY_COUNTS[ROOT as keyof typeof DEMO_CATEGORY_COUNTS] / 24);
  for (let index = 1; index <= pages; index += 1) {
    await page.goto(index === 1 ? `/categoria/${ROOT}` : `/categoria/${ROOT}?pagina=${index}`);
    const link = page.getByTestId('card-title').filter({ hasText: DEMO_LONG_TITLE.title.slice(0, 40) });
    if ((await link.count()) > 0) return (await link.first().getAttribute('href'))!;
  }
  throw new Error('the long-title demo product was not on any root page');
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Text whose rendered box is cut by an ancestor with overflow other than visible; the card title's line clamp is the one allowed cut. */
const cutText = (page: Page) =>
  page.evaluate(() => {
    const cuts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const content = (text.textContent ?? '').trim();
      const element = text.parentElement;
      if (!content || !element || ['SCRIPT', 'STYLE', 'OPTION', 'NOSCRIPT'].includes(element.tagName)) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      if (rects.length === 0) continue;
      let clamped = false;
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        if ((getComputedStyle(node) as CSSStyleDeclaration & { webkitLineClamp: string }).webkitLineClamp !== 'none') clamped = true;
      }
      if (clamped) continue;
      for (let node: HTMLElement | null = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const box = node.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) break;
        const hidden = rects.some(
          (rect) => rect.right > box.right + 1 || rect.left < box.left - 1 || rect.bottom > box.bottom + 1 || rect.top < box.top - 1,
        );
        if (hidden) cuts.push(`${content.slice(0, 40)} (in ${node.tagName.toLowerCase()}.${String(node.className).slice(0, 30)})`);
      }
    }
    return cuts;
  });

// S5.7 (AC 58, 60): 390 and 1280 are added beside 360 and 195.
const VIEWPORTS = [
  [1280, 800],
  [390, 844],
  [360, 740],
  [195, 422],
] as const;

for (const [width, height] of VIEWPORTS) {
  test.describe(`public pages at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const { name, url } of PAGES) {
      test(`${name} (${url}): no sideways scroll and no text cut`, async ({ page }) => {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        expect(await cutText(page)).toEqual([]);
      });
    }

    test('the long-title product: no sideways scroll and no text cut', async ({ page }) => {
      const url = await longTitleUrl(page);
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(await cutText(page)).toEqual([]);
    });

    test('the long-title product card on the root listing: no sideways scroll, the title may clamp', async ({ page }) => {
      await longTitleUrl(page);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  });
}

// S5.7 (T5.7.4, AC 58 to 60): the header with the longest car label selected, and the picker dialog
// at each of its three steps, at the four widths. The dialog's body scrolls on its own, so the
// vertical cut check of `cutText` does not apply there: the dialog gets a horizontal check and a
// reachability check of every control instead.
const SELECTED_PAGES: { name: string; url: string }[] = [
  { name: 'home', url: '/' },
  { name: 'root category', url: `/categoria/${ROOT}` },
  { name: 'four-offer product', url: `/producto/${DEMO_FOUR_OFFERS.slug}` },
  { name: 'search results', url: '/buscar?q=filtro' },
  { name: '404', url: '/no-existe' },
];

const dialogOf = (page: Page) => page.getByRole('dialog', { name: messages.CarPicker.title });

/** What is wrong inside the open dialog: sideways overflow, text outside its box, a control out of reach. */
const dialogProblems = (page: Page) =>
  page.evaluate(() => {
    const problems: string[] = [];
    const dialog = document.querySelector('[data-testid="car-dialog"]') as HTMLElement;
    const box = dialog.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (box.left < -1 || box.right > vw + 1 || box.top < -1 || box.bottom > vh + 1) problems.push('the dialog leaves the viewport');
    for (const node of [dialog, ...dialog.querySelectorAll<HTMLElement>('*')]) {
      if (getComputedStyle(node).overflowX !== 'visible' && node.scrollWidth > node.clientWidth + 1) {
        problems.push(`sideways scroll in ${node.tagName.toLowerCase()}.${String(node.className).slice(0, 30)}`);
      }
    }
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const content = (text.textContent ?? '').trim();
      if (!content) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && (rect.left < box.left - 1 || rect.right > box.right + 1)) {
          problems.push(`text outside the dialog: ${content.slice(0, 40)}`);
        }
      }
    }
    // Reachable: scrolled into view, the control sits inside the dialog and is what a press there hits.
    for (const control of dialog.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select')) {
      control.scrollIntoView({ block: 'nearest' });
      const rect = control.getBoundingClientRect();
      const label = control.getAttribute('data-testid') ?? control.tagName.toLowerCase();
      if (rect.width <= 0 || rect.height <= 0) {
        problems.push(`${label} has no box`);
        continue;
      }
      if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.left < -1 || rect.right > vw + 1) {
        problems.push(`${label} is sideways out of reach`);
      }
      if (rect.top < -1 || rect.bottom > vh + 1) problems.push(`${label} is below or above the viewport`);
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (hit === null || !(hit === control || control.contains(hit))) problems.push(`${label} is covered`);
    }
    return problems;
  });

for (const [width, height] of VIEWPORTS) {
  test.describe(`the car control and dialog at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const { name, url } of SELECTED_PAGES) {
      test(`${name}: the longest car label selected shows no sideways scroll and no text cut`, async ({ page }) => {
        await page.goto(`${url}${url.includes('?') ? '&' : '?'}coche=${LONGEST_CAR.slug}`);
        await expect(page.getByTestId('car-label')).toContainText(LONGEST_CAR.engine);
        await expect(page.getByTestId('car-change')).toBeVisible();
        await expect(page.getByTestId('car-remove')).toBeVisible();
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        expect(await cutText(page)).toEqual([]);
      });
    }

    test('the no-car header on the home page keeps its action visible and inside the viewport', async ({ page }) => {
      await page.goto('/');
      const select = page.getByTestId('car-select');
      await expect(select).toBeVisible();
      const box = (await select.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });

    test('each dialog step shows no sideways scroll, no text outside the panel and every control reachable', async ({ page }) => {
      await page.goto('/categoria/filtros-de-aire');
      await scriptedControl(page, false);
      await page.getByTestId('car-select').click();
      await expect(dialogOf(page)).toBeVisible();
      const step = dialogOf(page).getByTestId('car-picker-step');
      const options = dialogOf(page).getByTestId('car-picker-option');

      await expect(step).toHaveAttribute('data-step', '1');
      expect(await dialogProblems(page)).toEqual([]);
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      await options.filter({ hasText: LONGEST_CAR.make }).first().click();
      await expect(step).toHaveAttribute('data-step', '2');
      const models = modelsOf(LONGEST_CAR.makeSlug);
      await expect(options).toHaveCount(models.length);
      expect(await dialogProblems(page)).toEqual([]);
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      await options.filter({ hasText: `${LONGEST_CAR.model} ${LONGEST_CAR.generation}` }).first().click();
      await expect(step).toHaveAttribute('data-step', '3');
      await expect(options).toHaveCount(enginesOf(LONGEST_CAR.modelSlug).length);
      expect(await dialogProblems(page)).toEqual([]);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  });
}
