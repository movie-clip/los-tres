import { expect, test, type Page } from '@playwright/test';

import { DEMO_CATEGORY_COUNTS, DEMO_FOUR_OFFERS, DEMO_LONG_TITLE } from '../fixtures/demo';
import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';

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

for (const [width, height] of [
  [360, 740],
  [195, 422],
] as const) {
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
