import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_CATEGORY_COUNTS, DEMO_FOUR_OFFERS, DEMO_LONG_TITLE } from '../fixtures/demo';
import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import { CAR, LONGEST_CAR, enginesOf, modelsOf, scriptedControl } from '../support/car';

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

// S5.8 (#276, ACs 41, 42; 04-ux checks 30 and 33): the category page with a selected car, with the longest
// car label, at the four widths. Group headings, the counts line, the fits-empty note, the marks and the
// all-left-out card wrap and are not cut. The cases are the ones the demo data reaches with the longest car's
// own fit. The demo's longest car fits no product, so it reaches the fits-empty note, the no-data group and
// the all-left-out card, but never the fits group (its heading naming the longest car, and the marks): that
// state is not faked here and is named in the run report.
const FIT_PAGES: { name: string; url: string; marker: string }[] = [
  { name: 'root, note and no-data group', url: `/categoria/${ROOT}`, marker: 'listing-note' },
  { name: 'root, brand with no fits', url: `/categoria/${ROOT}?marca=mahle`, marker: 'listing-note' },
  { name: 'root, all left out with a brand', url: `/categoria/${ROOT}?marca=bosch`, marker: 'category-empty' },
  { name: 'air filters, note and no-data group', url: '/categoria/filtros-de-aire', marker: 'listing-note' },
  { name: 'air filters, all left out with a brand', url: '/categoria/filtros-de-aire?marca=bosch', marker: 'category-empty' },
];

for (const [width, height] of VIEWPORTS) {
  test.describe(`the category page with the longest car at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const { name, url, marker } of FIT_PAGES) {
      test(`${name}: no sideways scroll and no text cut`, async ({ page }) => {
        await page.goto(`${url}${url.includes('?') ? '&' : '?'}coche=${LONGEST_CAR.slug}`);
        await expect(page.getByTestId('car-label')).toContainText(LONGEST_CAR.engine);
        await expect(page.getByTestId(marker).first()).toBeVisible();
        // The counts line is the fit line, not the single product count: the page is in the car state.
        await expect(page.getByTestId('category-summary')).toContainText(messages.Fit.countUnknown.replace('{count}', '').trim());
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        expect(await cutText(page)).toEqual([]);
      });
    }

    test('the note and the all-left-out heading name the longest car and stay inside the viewport', async ({ page }) => {
      const inside = async (url: string, pick: (page: Page) => ReturnType<Page['locator']>) => {
        await page.goto(`${url}${url.includes('?') ? '&' : '?'}coche=${LONGEST_CAR.slug}`);
        const element = pick(page);
        await expect(element).toContainText(LONGEST_CAR.engine);
        const box = (await element.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      };
      await inside(`/categoria/${ROOT}`, (p) => p.getByTestId('listing-note'));
      await inside('/categoria/filtros-de-aire?marca=bosch', (p) =>
        p.getByTestId('category-empty').getByRole('heading', { level: 2 }),
      );
    });

    test('the all-left-out actions are inside the viewport and at least 44px tall', async ({ page }) => {
      await page.goto(`/categoria/filtros-de-aire?marca=bosch&coche=${LONGEST_CAR.slug}`);
      for (const id of ['category-empty-action', 'fit-change-car']) {
        const action = page.getByTestId(id);
        await expect(action).toBeVisible();
        const box = (await action.boundingBox())!;
        expect(box.x, id).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, id).toBeLessThanOrEqual(width + 0.5);
        expect(box.height, id).toBeGreaterThanOrEqual(44);
      }
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(await cutText(page)).toEqual([]);
    });
  });
}

// S5.8 (#277, 04-ux checks 30 and 33): the search page with the longest car, at the four widths. The
// counts line (term, four parts), the fits-empty note, the exact-hit group heading and explanation and the
// all-left-out card wrap and are not cut. The demo's longest car fits no product, so the fits group is not
// reached (same limit as the category block above); the exact-hit group and the all-left-out card are.
const SEARCH_FIT_PAGES: { name: string; url: string; marker: string }[] = [
  { name: 'text term, note and no-data group', url: '/buscar?q=filtro', marker: 'listing-note' },
  { name: 'exact part number, note and exact-hit group', url: '/buscar?q=OF-1124', marker: 'listing-group' },
  { name: 'exact EAN, exact-hit group', url: '/buscar?q=2000000100203', marker: 'listing-group' },
  { name: 'all left out', url: '/buscar?q=bosch+aire', marker: 'category-empty' },
  { name: 'no results, 100-character term', url: `/buscar?q=${'w'.repeat(100)}`, marker: 'category-empty' },
];

for (const [width, height] of VIEWPORTS) {
  test.describe(`the search page with the longest car at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const { name, url, marker } of SEARCH_FIT_PAGES) {
      test(`${name}: no sideways scroll and no text cut`, async ({ page }) => {
        await page.goto(`${url}&coche=${LONGEST_CAR.slug}`);
        await expect(page.getByTestId('car-label')).toContainText(LONGEST_CAR.engine);
        await expect(page.getByTestId(marker).first()).toBeVisible();
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        expect(await cutText(page)).toEqual([]);
      });
    }

    test('the counts line carries the term and the fit parts, inside the viewport', async ({ page }) => {
      await page.goto(`/buscar?q=OF-1124&coche=${LONGEST_CAR.slug}`);
      const line = page.getByTestId('search-summary');
      await expect(line).toContainText(messages.Search.summaryCarPrefix.replace('{term}', 'OF-1124'));
      await expect(line).toContainText(messages.Fit.countUnknown.replace('{count}', '0'));
      const box = (await line.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });

    test('the note, the exact-hit explanation and the all-left-out heading name the longest car and stay inside the viewport', async ({
      page,
    }) => {
      const inside = async (url: string, pick: (page: Page) => ReturnType<Page['locator']>) => {
        await page.goto(`${url}&coche=${LONGEST_CAR.slug}`);
        const element = pick(page);
        await expect(element).toContainText(LONGEST_CAR.engine);
        const box = (await element.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      };
      await inside('/buscar?q=filtro', (p) => p.getByTestId('listing-note'));
      await inside('/buscar?q=OF-1124', (p) => p.getByTestId('listing-group-help'));
      await inside('/buscar?q=bosch+aire', (p) => p.getByTestId('category-empty').getByRole('heading', { level: 2 }));
    });

    test('the all-left-out action is inside the viewport and at least 44px tall', async ({ page }) => {
      await page.goto(`/buscar?q=bosch+aire&coche=${LONGEST_CAR.slug}`);
      const action = page.getByTestId('fit-change-car');
      await expect(action).toBeVisible();
      const box = (await action.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(await cutText(page)).toEqual([]);
    });
  });
}

// S5.8 follow-up (D-14): the counts line wraps between its parts. For each part of the line with the longest
// car: when the part fits a line on its own, it must sit on one line (no break inside it); and the page never
// scrolls sideways. A part wider than the line may break (overflow-wrap anywhere), which is not asserted away.
const partProblems = (page: Page, testId: string) =>
  page.evaluate((id) => {
    const line = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const style = getComputedStyle(line);
    const room = line.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const parts = [...line.querySelectorAll<HTMLElement>(':scope > span')];
    const problems: string[] = [];
    if (parts.length < 2) problems.push(`only ${parts.length} part spans in ${id}`);
    // D-21: the " ·" ends the part before it, so the dot sits on the same line as that part's last character
    // and no line starts with it or holds it alone.
    for (const separator of line.querySelectorAll<HTMLElement>(':scope > span > span')) {
      const text = separator.previousSibling;
      const dot = separator.firstChild;
      if (!text || !dot || !text.textContent || dot.textContent !== ' ·') {
        problems.push(`separator span in ${id} is not " ·" after part text`);
        continue;
      }
      const rectOf = (node: Node, start: number) => {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + 1);
        return range.getBoundingClientRect();
      };
      const before = rectOf(text, text.textContent.length - 1);
      const after = rectOf(dot, 1);
      if (Math.round(before.top) !== Math.round(after.top)) problems.push(`the dot after "${text.textContent}" starts a new line`);
    }
    for (const part of parts) {
      const clone = part.cloneNode(true) as HTMLElement;
      clone.style.whiteSpace = 'nowrap';
      clone.style.position = 'absolute';
      clone.style.visibility = 'hidden';
      line.appendChild(clone);
      const natural = clone.getBoundingClientRect().width;
      clone.remove();
      const range = document.createRange();
      range.selectNodeContents(part);
      const tops = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)));
      if (natural <= room && tops.size > 1) problems.push(`"${part.textContent}" fits a line (${natural.toFixed(0)} <= ${room.toFixed(0)}) but breaks into ${tops.size} lines`);
    }
    return problems;
  }, testId);

for (const [width, height] of VIEWPORTS) {
  test.describe(`the counts line with the longest car at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    const LINES: { name: string; url: string; testId: string }[] = [
      { name: 'category counts line', url: `/categoria/${ROOT}`, testId: 'category-summary' },
      { name: 'air filters counts line', url: '/categoria/filtros-de-aire', testId: 'category-summary' },
      { name: 'search counts line', url: '/buscar?q=OF-1124', testId: 'search-summary' },
    ];

    for (const { name, url, testId } of LINES) {
      test(`${name}: no break inside a part that fits a line, no sideways scroll`, async ({ page }) => {
        await page.goto(`${url}${url.includes('?') ? '&' : '?'}coche=${LONGEST_CAR.slug}`);
        await expect(page.getByTestId('car-label')).toContainText(LONGEST_CAR.engine);
        await expect(page.getByTestId(testId)).toBeVisible();
        expect(await partProblems(page, testId)).toEqual([]);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    }
  });
}

// S5.9 (#279, 04-ux checks 8, 10, 12, 29 and 30; story AC 32): the fit banner in its three demo states at the
// four widths. The longest car cannot fit any demo product, so it carries the no-fit and unknown banners (the two
// wide ones, with the link and the help line); the fits banner uses the demo car. The could-not-check line has no
// demo state: it shares the banner's box and wrapping, and its words are proven in product-fit.test.ts.
const BANNER_PAGES: { name: string; slug: string; car: { slug: string }; kind: string; link: boolean }[] = [
  { name: 'fits (demo car)', slug: 'demo-filtro-de-aceite-bosch-of-3306', car: CAR, kind: 'fits', link: false },
  { name: 'no-fit (longest car)', slug: 'demo-filtro-de-aceite-mahle-of-1124', car: LONGEST_CAR, kind: 'no-fit', link: true },
  { name: 'unknown (longest car)', slug: 'demo-filtro-de-aceite-oc-1234', car: LONGEST_CAR, kind: 'unknown', link: false },
];

for (const [width, height] of VIEWPORTS) {
  test.describe(`the fit banner at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const { name, slug, car, kind, link } of BANNER_PAGES) {
      test(`${name}: no sideways scroll, no text cut, as wide as the cards above and below it`, async ({ page }) => {
        await page.goto(`/producto/${slug}?coche=${car.slug}`);
        const banner = page.getByTestId('fit-banner');
        await expect(banner).toHaveAttribute('data-fit', kind);
        await expect(banner).toBeVisible();
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        expect(await cutText(page)).toEqual([]);

        const geometry = await banner.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const before = node.previousElementSibling!.getBoundingClientRect();
          const after = node.nextElementSibling!.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            width: box.width,
            beforeWidth: before.width,
            afterWidth: after.width,
            gapAbove: box.top - before.bottom,
            gapBelow: after.top - box.bottom,
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(width + 0.5);
        // Check 12: the card's own width, with the page's grid gap above and below and no extra margin.
        expect(Math.abs(geometry.width - geometry.beforeWidth)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.width - geometry.afterWidth)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.gapAbove - geometry.gapBelow)).toBeLessThanOrEqual(1);
      });
    }

    test('the no-fit link is inside the banner, at least 44px tall, under the sentence when narrow and beside it at 1280', async ({
      page,
    }) => {
      await page.goto(`/producto/demo-filtro-de-aceite-mahle-of-1124?coche=${LONGEST_CAR.slug}`);
      const banner = page.getByTestId('fit-banner');
      await expect(banner).toHaveAttribute('data-fit', 'no-fit');
      const link = page.getByTestId('fit-banner-link');
      await expect(link).toBeVisible();
      const rects = await page.evaluate(() => {
        const rect = (selector: string) => {
          const box = document.querySelector(selector)!.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
        };
        const text = [...document.querySelectorAll('[data-testid="fit-banner"] span')].find((node) => node.textContent?.trim());
        const label = text!.getBoundingClientRect();
        return {
          banner: rect('[data-testid="fit-banner"]'),
          link: rect('[data-testid="fit-banner-link"]'),
          label: { left: label.left, right: label.right, top: label.top, bottom: label.bottom },
        };
      });
      expect(rects.link.height).toBeGreaterThanOrEqual(44);
      expect(rects.link.left).toBeGreaterThanOrEqual(rects.banner.left - 0.5);
      expect(rects.link.right).toBeLessThanOrEqual(Math.min(rects.banner.right, width) + 0.5);
      expect(rects.link.bottom).toBeLessThanOrEqual(rects.banner.bottom + 0.5);
      if (width === 1280) {
        expect(rects.link.left, 'the link sits beside the sentence').toBeGreaterThanOrEqual(rects.label.right - 0.5);
      } else {
        expect(rects.link.top, 'the link sits under the sentence').toBeGreaterThanOrEqual(rects.label.bottom - 0.5);
      }
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  });
}
