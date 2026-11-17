import { spawnSync } from 'node:child_process';

import { expect, test, type Locator, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_CATEGORY_COUNTS, DEMO_CATEGORY_NAMES } from '../fixtures/demo';
import {
  CAR,
  SAME_MODEL,
  UNKNOWN_SLUG,
  carName,
  cocheValues,
  fitCountsLine,
  queryOf,
} from '../support/car';
import { icuPlural } from '../support/messages';
import { expectNoForeignOrigin, expectNoSetCookie, openRawHtml } from '../support/page-checks';

// US-5.8 T5.8.2 (#276): the category page with a selected car, on the demo car (CAR). Elements are
// selected by the data-testid values of the frontend handoff (listing-group[-heading|-help], fit-mark,
// listing-note, category-summary, category-empty[-action|-second-action], fit-change-car) and by role
// for headings. The cases are the ones the demo data reaches (04-ux § Producing the states):
//
//   root                 10 fits, 23 no data, 17 hidden   (page 1: 10 + 14, page 2: 9)
//   root, marca=mahle     0 fits,  1 no data,  5 hidden   (the fits-empty note)
//   root, marca=bosch     2 fits,  0 no data,  4 hidden   (no no-data group)
//   filtros-de-aire       Bosch and Mahle have no chip (all their products are hidden)
//   filtros-de-aire, marca=bosch   all left out, two actions, 2 hidden
//
// A category that is all left out with no brand, and a fits-only category, are not reachable with CAR
// (they are named in the run report, not faked here).

const ROOT = 'mantenimiento-del-coche';
const AIR = 'filtros-de-aire';
const EMPTY = 'filtros-de-combustible';
const PAGE_SIZE = 24;

/** The counts of the root with CAR, measured on the demo database (04-ux). They add up to the root's public count. */
const ROOT_FIT = { fits: 10, unknown: 23, leftOut: 17 };
const MAHLE = { fits: 0, unknown: 1, leftOut: 5 };
const BOSCH = { fits: 2, unknown: 0, leftOut: 4 };
const AIR_BOSCH_HIDDEN = 2;
const FITS_ON_PAGE_ONE = ROOT_FIT.fits;
const UNKNOWN_ON_PAGE_ONE = PAGE_SIZE - FITS_ON_PAGE_ONE;
const ROOT_PAGES = Math.ceil((ROOT_FIT.fits + ROOT_FIT.unknown) / PAGE_SIZE);

const car = (path: string, slug: string = CAR.slug): string => `${path}${path.includes('?') ? '&' : '?'}coche=${slug}`;
const rootUrl = (query = ''): string => `/categoria/${ROOT}${query}`;
const airUrl = (query = ''): string => `/categoria/${AIR}${query}`;
const carText = carName(CAR);

const groups = (page: Page) => page.getByTestId('listing-group');
const group = (page: Page, kind: 'fits' | 'unknown' | 'no-fit-exact') =>
  page.locator(`[data-testid="listing-group"][data-group="${kind}"]`);
const cardsIn = (scope: Locator) => scope.getByTestId('category-card');
const summary = (page: Page) => page.getByTestId('category-summary');

const chipTexts = (page: Page): Promise<string[]> =>
  page
    .getByTestId('brand-chips-wide')
    .getByTestId('brand-chip')
    .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()));

test.describe('category page with a car: the grouped listing (ACs 5 to 9)', () => {
  test('AC 5, 6, 8, 9: root page 1 shows the fits group, then the no-data group, marks, and the counts line', async ({ page }) => {
    await page.goto(car(rootUrl()));
    await expect(page.getByTestId('car-label')).toBeVisible();

    await expect(groups(page)).toHaveCount(2);
    await expect(groups(page).nth(0)).toHaveAttribute('data-group', 'fits');
    await expect(groups(page).nth(1)).toHaveAttribute('data-group', 'unknown');

    // AC 5: the fits heading names the car; the no-data heading carries its explanation.
    await expect(group(page, 'fits').getByTestId('listing-group-heading')).toHaveText(
      messages.Fit.fitsHeading.replace('{car}', carText),
    );
    await expect(group(page, 'fits').getByTestId('listing-group-help')).toHaveCount(0);
    await expect(group(page, 'unknown').getByTestId('listing-group-heading')).toHaveText(messages.Fit.unknownHeading);
    await expect(group(page, 'unknown').getByTestId('listing-group-help')).toHaveText(messages.Fit.unknownHelp);

    // The page holds the whole fits group, then the rest of the page from the no-data group.
    await expect(cardsIn(group(page, 'fits'))).toHaveCount(FITS_ON_PAGE_ONE);
    await expect(cardsIn(group(page, 'unknown'))).toHaveCount(UNKNOWN_ON_PAGE_ONE);

    // AC 8: every fits card carries the Compatible mark, as text; no no-data card carries any mark.
    const fitsMarks = group(page, 'fits').getByTestId('fit-mark');
    await expect(fitsMarks).toHaveCount(FITS_ON_PAGE_ONE);
    for (const text of await fitsMarks.allTextContents()) expect(text.trim()).toBe(messages.Fit.markFits);
    await expect(fitsMarks.first()).toHaveAttribute('data-fit', 'fits');
    await expect(group(page, 'unknown').getByTestId('fit-mark')).toHaveCount(0);

    // AC 9: three numbers, then the page indicator, in place of the single product count.
    await expect(summary(page)).toHaveText(fitCountsLine(ROOT_FIT, [1, ROOT_PAGES]));
    const line = (await summary(page).textContent()) ?? '';
    expect(line).not.toMatch(/(^|\D)\d+ productos?(\D|$)/);
  });

  test('AC 11 (as shown): the three numbers add up to the public products the root lists without a car', async () => {
    expect(ROOT_FIT.fits + ROOT_FIT.unknown + ROOT_FIT.leftOut).toBe(DEMO_CATEGORY_COUNTS[ROOT]);
  });

  test('AC 6, 7: page 2 holds only the no-data group, with its heading and explanation repeated, and no fits heading', async ({ page }) => {
    await page.goto(car(rootUrl('?pagina=2')));
    await expect(groups(page)).toHaveCount(1);
    await expect(groups(page).first()).toHaveAttribute('data-group', 'unknown');
    await expect(group(page, 'fits')).toHaveCount(0);
    await expect(page.getByText(messages.Fit.fitsHeading.replace('{car}', carText), { exact: true })).toHaveCount(0);
    await expect(group(page, 'unknown').getByTestId('listing-group-heading')).toHaveText(messages.Fit.unknownHeading);
    await expect(group(page, 'unknown').getByTestId('listing-group-help')).toHaveText(messages.Fit.unknownHelp);
    await expect(cardsIn(group(page, 'unknown'))).toHaveCount(ROOT_FIT.unknown - UNKNOWN_ON_PAGE_ONE);
    await expect(page.getByTestId('fit-mark')).toHaveCount(0);
    // The line is the same as on page 1 apart from the page indicator.
    await expect(summary(page)).toHaveText(fitCountsLine(ROOT_FIT, [2, ROOT_PAGES]));
  });

  test('the pages list every fits and no-data product once, and no hidden product (AC 2, 16 as shown)', async ({ page }) => {
    const titles: string[] = [];
    for (let index = 1; index <= ROOT_PAGES; index += 1) {
      await page.goto(car(rootUrl(index === 1 ? '' : `?pagina=${index}`)));
      titles.push(...(await page.getByTestId('card-title').allTextContents()));
    }
    expect(titles).toHaveLength(ROOT_FIT.fits + ROOT_FIT.unknown);
    expect(new Set(titles).size).toBe(titles.length);
    await page.goto(car(rootUrl()));
    await expect(page.getByTestId('fit-mark').filter({ hasText: messages.Fit.markNoFit })).toHaveCount(0);
  });

  test('AC 13 as shown: with the other sort every fits card still comes before every no-data card', async ({ page }) => {
    await page.goto(car(rootUrl('?orden=precio-desc')));
    const order = await page
      .getByTestId('category-card')
      .evaluateAll((nodes) => nodes.map((node) => node.querySelector('[data-testid="fit-mark"]') !== null));
    expect(order.length).toBeGreaterThan(0);
    const firstUnmarked = order.indexOf(false);
    expect(firstUnmarked).toBeGreaterThan(0);
    expect(order.slice(firstUnmarked).includes(true)).toBe(false);
  });
});

test.describe('category page with a car: brand, counts and chips (ACs 12, 14, 15)', () => {
  test('AC 19: a brand with no fits shows the note, the no-data group and no fits heading', async ({ page }) => {
    await page.goto(car(rootUrl('?marca=mahle')));
    const note = page.getByTestId('listing-note');
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText(messages.Fit.noFitsNote.replace('{car}', carText));
    await expect(note).toHaveAttribute('role', 'note');
    await expect(group(page, 'fits')).toHaveCount(0);
    await expect(groups(page)).toHaveCount(1);
    await expect(group(page, 'unknown').getByTestId('listing-group-heading')).toHaveText(messages.Fit.unknownHeading);
    await expect(cardsIn(group(page, 'unknown'))).toHaveCount(MAHLE.unknown);
    await expect(page.getByTestId('fit-mark')).toHaveCount(0);
    // The note sits above the first section.
    const noteBeforeGroup = await page.evaluate(() => {
      const noteNode = document.querySelector('[data-testid="listing-note"]') as Node;
      const groupNode = document.querySelector('[data-testid="listing-group"]') as Node;
      return Boolean(noteNode.compareDocumentPosition(groupNode) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(noteBeforeGroup).toBe(true);
    // AC 12: the numbers describe the brand only.
    await expect(summary(page)).toHaveText(fitCountsLine(MAHLE));
  });

  test('AC 20: a brand with fits and no no-data shows the fits group only, no note, no no-data heading', async ({ page }) => {
    await page.goto(car(rootUrl('?marca=bosch')));
    await expect(groups(page)).toHaveCount(1);
    await expect(groups(page).first()).toHaveAttribute('data-group', 'fits');
    await expect(cardsIn(group(page, 'fits'))).toHaveCount(BOSCH.fits);
    await expect(page.getByText(messages.Fit.unknownHeading, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('listing-note')).toHaveCount(0);
    await expect(summary(page)).toHaveText(fitCountsLine(BOSCH));
  });

  test('AC 15, 16 as shown: chip counts are the listed counts, and a brand with nothing listed has no chip', async ({ page }) => {
    await page.goto(car(rootUrl()));
    const rootChips = await chipTexts(page);
    expect(rootChips.length).toBeGreaterThan(1);
    for (const text of rootChips) expect(text, text).not.toMatch(/(^|\D)0$/);
    // Mann-Filter lists 6 for the car (8 are public in all), never the unfiltered total.
    const mann = rootChips.find((text) => text.startsWith('Mann-Filter'));
    expect(mann).toBeDefined();
    expect(mann!.replace(/\D+/g, '')).toBe('6');

    await page.goto(car(airUrl()));
    const airChips = await chipTexts(page);
    expect(airChips.length).toBeGreaterThan(0);
    expect(airChips.some((text) => text.startsWith('Bosch'))).toBe(false);
    expect(airChips.some((text) => text.startsWith('Mahle'))).toBe(false);
    for (const text of airChips) expect(text, text).not.toMatch(/(^|\D)0$/);
  });

  test('AC 15: a chip count does not change when a brand is chosen', async ({ page }) => {
    await page.goto(car(rootUrl()));
    const before = await chipTexts(page);
    await page.goto(car(rootUrl('?marca=bosch')));
    expect(await chipTexts(page)).toEqual(before);
  });
});

test.describe('category page with a car: all left out and the other empty states (ACs 21, 22, 23)', () => {
  test('AC 21: a brand with every product hidden shows the all-left-out card with two actions, and the zero counts line', async ({ page }) => {
    await page.goto(car(airUrl('?marca=bosch')));
    const card = page.getByTestId('category-empty');
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(
      messages.Category.allOutHeading.replace('{car}', carText),
    );
    await expect(card).toContainText(icuPlural(messages.Fit.allOutBody, AIR_BOSCH_HIDDEN));
    // Not the brand no-match copy, not the empty-category copy.
    await expect(card).not.toContainText(messages.Category.noMatchHeading);
    await expect(card).not.toContainText(messages.Category.emptyHeading);

    const remove = page.getByTestId('category-empty-action');
    const change = page.getByTestId('fit-change-car');
    await expect(remove).toHaveText(messages.Category.noMatchAction);
    await expect(change).toHaveText(messages.Fit.changeCar);
    // Order: Quitar el filtro, then Cambiar de coche.
    const order = await card.locator('a').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
    expect(order).toEqual(['category-empty-action', 'fit-change-car']);

    await expect(summary(page)).toHaveText(fitCountsLine({ fits: 0, unknown: 0, leftOut: AIR_BOSCH_HIDDEN }));
    await expect(groups(page)).toHaveCount(0);
    await expect(page.getByTestId('category-sort-select')).toHaveCount(0);
    await expect(page.getByTestId('pagination')).toHaveCount(0);
    // The panel stays and Bosch has no chip.
    await expect(page.getByTestId('category-panel')).toBeVisible();
    expect((await chipTexts(page)).some((text) => text.startsWith('Bosch'))).toBe(false);
  });

  test('AC 21: the second brand with every product hidden (Mahle) is the same state', async ({ page }) => {
    await page.goto(car(airUrl('?marca=mahle')));
    await expect(page.getByTestId('fit-change-car')).toBeVisible();
    await expect(page.getByTestId('category-empty')).not.toContainText(messages.Category.noMatchHeading);
    await expect(groups(page)).toHaveCount(0);
  });

  test('AC 21, 17: "Quitar el filtro" goes to the category without the brand, keeping the car', async ({ page }) => {
    await page.goto(car(airUrl('?marca=bosch')));
    const href = (await page.getByTestId('category-empty-action').getAttribute('href')) ?? '';
    expect(new URL(href, 'http://h.invalid').pathname).toBe(`/categoria/${AIR}`);
    expect(queryOf(href).map(([key]) => key)).not.toContain('marca');
    expect(cocheValues(href)).toEqual([CAR.slug]);
    await page.getByTestId('category-empty-action').click();
    await page.waitForURL((url) => url.pathname === `/categoria/${AIR}` && !url.searchParams.has('marca'));
    await expect(groups(page).first()).toBeVisible();
    await expect(page.getByTestId('car-label')).toBeVisible();
  });

  test('AC 21, 23: the change-car action is the header change link, with the listing as the way back', async ({ page, request, browser }) => {
    await page.goto(car(airUrl('?marca=bosch')));
    const href = (await page.getByTestId('fit-change-car').getAttribute('href')) ?? '';
    // The header's change action is a button once hydrated, so its link is read from the server HTML.
    const { page: raw, close } = await openRawHtml(browser, await (await request.get(car(airUrl('?marca=bosch')))).text());
    try {
      expect(await raw.getByTestId('car-change').getAttribute('href')).toBe(href);
    } finally {
      await close();
    }
    const target = new URL(href, 'http://h.invalid');
    expect(target.pathname).toBe('/mi-coche');
    expect(target.searchParams.get('marca')).toBe(CAR.makeSlug);
    expect(target.searchParams.get('modelo')).toBe(CAR.modelSlug);
    const back = target.searchParams.get('volver') ?? '';
    expect(new URL(back, 'http://h.invalid').pathname).toBe(`/categoria/${AIR}`);
    expect(queryOf(back)).toContainEqual(['marca', 'bosch']);
  });

  test('AC 22 (check 22): a brand with no product at all in the category is still the brand no-match state', async ({ page }) => {
    await page.goto(car(airUrl('?marca=no-existe')));
    const card = page.getByTestId('category-empty');
    await expect(card).toContainText(messages.Category.noMatchHeading);
    await expect(card).not.toContainText(messages.Fit.changeCar);
    await expect(page.getByTestId('fit-change-car')).toHaveCount(0);
    await expect(page.getByTestId('category-empty-action')).toHaveText(messages.Category.noMatchAction);
    await expect(groups(page)).toHaveCount(0);
  });

  test('AC 22: a category with no public product shows the empty-category state, with no counts line and no fit wording', async ({ page }) => {
    await page.goto(car(`/categoria/${EMPTY}`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_CATEGORY_NAMES[EMPTY]);
    await expect(page.getByTestId('category-empty')).toContainText(messages.Category.emptyHeading);
    await expect(summary(page)).toHaveCount(0);
    await expect(groups(page)).toHaveCount(0);
    await expect(page.getByTestId('fit-change-car')).toHaveCount(0);
    const text = (await page.locator('main').innerText()).toLowerCase();
    expect(text).not.toContain('compatible');
    expect(text).not.toContain('sin datos');
  });
});

test.describe('category page with a car: outline and card reading (ACs 17, 42)', () => {
  test('AC 42: h1, then h2 group headings, then h3 card titles; the cards are not h2', async ({ page }) => {
    await page.goto(car(rootUrl()));
    const outline = await page
      .locator('main')
      .locator('h1, h2, h3, h4, h5, h6')
      .evaluateAll((nodes) => nodes.map((node) => node.tagName.toLowerCase()));
    // One h1, one h2 per group and one h3 per card, in this order, with no level skipped.
    expect(outline).toEqual([
      'h1',
      'h2',
      ...Array<string>(FITS_ON_PAGE_ONE).fill('h3'),
      'h2',
      ...Array<string>(UNKNOWN_ON_PAGE_ONE).fill('h3'),
    ]);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      messages.Fit.fitsHeading.replace('{car}', carText),
      messages.Fit.unknownHeading,
    ]);
    // The title link lives in its heading, and the sections are named by their heading.
    await expect(page.getByRole('region', { name: messages.Fit.unknownHeading })).toHaveCount(1);
    await expect(page.getByRole('region', { name: messages.Fit.fitsHeading.replace('{car}', carText) })).toHaveCount(1);
  });

  test('AC 42: with no car, an unrecognised car or a malformed car the cards stay h2 with no group heading', async ({ page }) => {
    for (const path of [rootUrl(), car(rootUrl(), UNKNOWN_SLUG), rootUrl('?coche=Mal%20Formado%21')]) {
      await page.goto(path);
      const outline = await page
        .locator('main')
        .locator('h1, h2, h3, h4, h5, h6')
        .evaluateAll((nodes) => nodes.map((node) => node.tagName.toLowerCase()));
      expect(outline[0], path).toBe('h1');
      expect(outline.slice(1), path).toHaveLength(PAGE_SIZE);
      expect(new Set(outline.slice(1)), path).toEqual(new Set(['h2']));
    }
  });

  test('AC 42: the mark is real text and the card link is described by it; a no-data card link has no description', async ({ page }) => {
    await page.goto(car(rootUrl()));
    const fitsCard = cardsIn(group(page, 'fits')).first();
    const mark = fitsCard.getByTestId('fit-mark');
    await expect(mark).toHaveText(messages.Fit.markFits);
    const markId = (await mark.getAttribute('id')) ?? '';
    expect(markId).not.toBe('');
    await expect(fitsCard.getByTestId('card-title')).toHaveAttribute('aria-describedby', markId);
    // Ids are unique on the page.
    const ids = await page.getByTestId('fit-mark').evaluateAll((nodes) => nodes.map((node) => node.id));
    expect(new Set(ids).size).toBe(ids.length);
    await expect(cardsIn(group(page, 'unknown')).first().getByTestId('card-title')).not.toHaveAttribute(
      'aria-describedby',
      /.+/,
    );
    // The glyph is hidden from the accessibility tree; the words are what is read.
    await expect(mark.locator('[aria-hidden="true"]')).toHaveCount(1);
  });

  test('the headings, marks and note are not tab stops: the only controls in a group are the card links', async ({ page }) => {
    await page.goto(car(rootUrl()));
    for (const kind of ['fits', 'unknown'] as const) {
      const scope = group(page, kind);
      const stops = await scope
        .locator('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
      expect(stops, kind).toEqual(Array<string>(await cardsIn(scope).count()).fill('card-title'));
    }
  });

  test('AC 42: each card is still one link to its product page', async ({ page }) => {
    await page.goto(car(rootUrl()));
    const hrefs = await page.getByTestId('card-title').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(hrefs).toHaveLength(PAGE_SIZE);
    for (const href of hrefs) expect(href).toMatch(/^\/producto\/[^?]+\?coche=/);
  });
});

/** The category pages the car-link crawl reads: every state with something to link. */
const CAR_PAGES: [string, string][] = [
  ['root, grouped', rootUrl()],
  ['root page 2', rootUrl('?pagina=2')],
  ['root, brand with no fits', rootUrl('?marca=mahle')],
  ['root, brand with fits only', rootUrl('?marca=bosch')],
  ['air filters, chips without zero brands', airUrl()],
  ['air filters, all left out', airUrl('?marca=bosch')],
];

/** The car-select, car-change, car-remove actions and the all-left-out change action: the picker's own links. */
const PICKER_ACTIONS = new Set(['car-select', 'car-change', 'car-remove', 'fit-change-car']);

test.describe('category page with a car: every link and form keeps coche (AC 17)', () => {
  for (const [name, path] of CAR_PAGES) {
    test(`${name}: every internal anchor but /go and the picker actions ends in coche=<slug>, once`, async ({ page }) => {
      await page.goto(car(path));
      await expect(page.getByTestId('car-label')).toBeVisible();
      const anchors = await page
        .locator('a[href]')
        .evaluateAll((nodes) => nodes.map((node) => ({ href: node.getAttribute('href') ?? '', testid: node.getAttribute('data-testid') })));
      const carried = anchors.filter(
        (anchor) =>
          anchor.href.startsWith('/') &&
          !anchor.href.startsWith('//') &&
          !anchor.href.startsWith('/go/') &&
          !PICKER_ACTIONS.has(anchor.testid ?? ''),
      );
      expect(carried.length, name).toBeGreaterThanOrEqual(4);
      for (const anchor of carried) {
        expect(cocheValues(anchor.href), `${name}: ${anchor.href}`).toEqual([CAR.slug]);
        expect(queryOf(anchor.href).at(-1), `${name}: ${anchor.href}`).toEqual(['coche', CAR.slug]);
      }
      // The picker's own links carry the car only through volver, never as a second coche.
      for (const anchor of anchors.filter((item) => item.testid === 'fit-change-car')) {
        expect(cocheValues(anchor.href), anchor.href).toEqual([]);
      }
    });
  }

  test('the grouped page names the new elements by their own testids: chips, cards and pagination carry the car', async ({ page }) => {
    await page.goto(car(rootUrl()));
    for (const id of ['card-title', 'pagination-next']) {
      const hrefs = await page.getByTestId(id).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
      expect(hrefs.length, id).toBeGreaterThan(0);
      for (const href of hrefs) expect(cocheValues(href), `${id}: ${href}`).toEqual([CAR.slug]);
    }
    const chips = await page.getByTestId('brand-chip').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(chips.length).toBeGreaterThan(0);
    for (const href of chips) expect(cocheValues(href), href).toEqual([CAR.slug]);
  });

  test('the sort form carries the car and the brand as hidden inputs, and submitting it keeps the grouped view', async ({ page }) => {
    await page.goto(car(rootUrl('?marca=bosch')));
    const select = page.getByTestId('category-sort-select');
    const current = await select.inputValue();
    const options = await select.locator('option').evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    const other = options.find((value) => value !== current)!;
    await select.selectOption(other);
    await page.getByTestId('category-sort-submit').click();
    await page.waitForURL((url) => url.searchParams.get('orden') === other);
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    expect(queryOf(page.url())).toContainEqual(['marca', 'bosch']);
    await expect(groups(page).first()).toHaveAttribute('data-group', 'fits');
    await expect(summary(page)).toHaveText(fitCountsLine(BOSCH));
  });

  test('AC 17: pagination goes to page 2 of the grouped listing with the car, and back', async ({ page }) => {
    await page.goto(car(rootUrl()));
    await page.getByTestId('pagination-next').click();
    await page.waitForURL((url) => url.searchParams.get('pagina') === '2');
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    await expect(groups(page)).toHaveCount(1);
    await page.getByTestId('pagination-prev').click();
    await page.waitForURL((url) => !url.searchParams.has('pagina'));
    await expect(groups(page)).toHaveCount(2);
  });
});

test.describe('category page with a car: the unchanged no-car page (ACs 24, 25 as shown)', () => {
  const unchanged: [string, string][] = [
    ['no car', rootUrl()],
    ['an unrecognised car', car(rootUrl(), UNKNOWN_SLUG)],
    ['a malformed car', rootUrl('?coche=Mal%20Formado%21')],
  ];
  for (const [kind, path] of unchanged) {
    test(`${kind}: one grid, the single product count, no heading, no mark, no note`, async ({ page }) => {
      await page.goto(path);
      const total = DEMO_CATEGORY_COUNTS[ROOT];
      const pages = Math.ceil(total / PAGE_SIZE);
      await expect(summary(page)).toHaveText(
        `${icuPlural(messages.Category.summary, total)} · ${messages.Category.pageIndicator.replace('{page}', '1').replace('{pages}', String(pages))}`,
      );
      await expect(groups(page)).toHaveCount(0);
      await expect(page.getByTestId('fit-mark')).toHaveCount(0);
      await expect(page.getByTestId('listing-note')).toHaveCount(0);
      await expect(page.getByTestId('listing-group-heading')).toHaveCount(0);
      await expect(page.getByTestId('category-card')).toHaveCount(PAGE_SIZE);
      expect(await page.getByTestId('card-title').evaluateAll((nodes) => nodes.filter((node) => node.hasAttribute('aria-describedby')).length)).toBe(0);
      // Without a car every brand chip lists its full count (the 8 of Mann-Filter, not the car's 6).
      const mann = (await chipTexts(page)).find((text) => text.startsWith('Mann-Filter'));
      expect(mann?.replace(/\D+/g, '')).toBe('8');
    });
  }

  test('with no car the all-left-out state is not reachable: a brand with products shows the plain listing', async ({ page }) => {
    await page.goto(airUrl('?marca=bosch'));
    await expect(page.getByTestId('fit-change-car')).toHaveCount(0);
    await expect(groups(page)).toHaveCount(0);
    await expect(cardsIn(page.locator('main'))).not.toHaveCount(0);
  });
});

test.describe('category page with a car: JavaScript off (AC 39)', () => {
  test.use({ javaScriptEnabled: false });

  test('the grouped view, marks, counts and note are in the server HTML', async ({ page }) => {
    await page.goto(car(rootUrl()));
    await expect(groups(page)).toHaveCount(2);
    await expect(page.getByTestId('fit-mark')).toHaveCount(FITS_ON_PAGE_ONE);
    await expect(summary(page)).toHaveText(fitCountsLine(ROOT_FIT, [1, ROOT_PAGES]));
    await page.goto(car(rootUrl('?marca=mahle')));
    await expect(page.getByTestId('listing-note')).toBeVisible();
    await expect(summary(page)).toHaveText(fitCountsLine(MAHLE));
  });

  test('the all-left-out card renders with both actions', async ({ page }) => {
    await page.goto(car(airUrl('?marca=bosch')));
    await expect(page.getByTestId('category-empty')).toBeVisible();
    await expect(page.getByTestId('category-empty-action')).toBeVisible();
    await expect(page.getByTestId('fit-change-car')).toBeVisible();
    await expect(summary(page)).toHaveText(fitCountsLine({ fits: 0, unknown: 0, leftOut: AIR_BOSCH_HIDDEN }));
  });

  test('AC 23: Cambiar de coche leads through the picker steps and back to the same listing with the new car', async ({ page, context }) => {
    await page.goto(car(airUrl('?marca=bosch')));
    await page.getByTestId('fit-change-car').click();
    await page.waitForURL((url) => url.pathname === '/mi-coche');
    await expect(page.getByTestId('car-picker-step')).toHaveAttribute('data-step', '3');
    await page.getByTestId('car-picker-option').filter({ hasText: SAME_MODEL.engine }).first().click();
    await page.waitForURL((url) => url.pathname === `/categoria/${AIR}`);
    expect(new URL(page.url()).searchParams.get('marca')).toBe('bosch');
    expect(cocheValues(page.url())).toEqual([SAME_MODEL.slug]);
    await expect(page.getByTestId('car-label')).toContainText(SAME_MODEL.engine);
    expect(await context.cookies()).toEqual([]);
  });

  test('AC 21, 39: Quitar el filtro works as a plain link and the grouped listing returns', async ({ page }) => {
    await page.goto(car(airUrl('?marca=bosch')));
    await page.getByTestId('category-empty-action').click();
    await page.waitForURL((url) => url.pathname === `/categoria/${AIR}` && !url.searchParams.has('marca'));
    await expect(groups(page).first()).toBeVisible();
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
  });

  test('chips, sort and pagination are plain links and a form: the sort submits with script off', async ({ page }) => {
    await page.goto(car(rootUrl()));
    await page.getByTestId('brand-chips-wide').getByTestId('brand-chip').first().click();
    await page.waitForURL((url) => url.searchParams.has('marca'));
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    await page.getByTestId('category-sort-select').selectOption({ index: 1 });
    await page.getByTestId('category-sort-submit').click();
    await page.waitForURL((url) => url.searchParams.has('orden'));
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    await expect(groups(page).first()).toBeVisible();
  });
});

test.describe('category page with a car: indexing, cookies and storage (ACs 37, 38 category side)', () => {
  const STATES: [string, string][] = [
    ['root', rootUrl()],
    ['root page 2', rootUrl('?pagina=2')],
    ['brand with no fits', rootUrl('?marca=mahle')],
    ['brand with fits only', rootUrl('?marca=bosch')],
    ['air filters', airUrl()],
    ['all left out', airUrl('?marca=bosch')],
    ['no-match brand', airUrl('?marca=no-existe')],
  ];

  for (const [name, path] of STATES) {
    test(`${name}: noindex, no canonical, no Set-Cookie`, async ({ request, browser }) => {
      const response = await request.get(car(path), { maxRedirects: 0 });
      expect(response.status()).toBe(200);
      expectNoSetCookie(response);
      const { page, close } = await openRawHtml(browser, await response.text());
      try {
        const robots = await page.locator('meta[name="robots"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''));
        expect(robots.some((content) => /noindex/.test(content)), robots.join(' | ')).toBe(true);
        await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      } finally {
        await close();
      }
    });
  }

  test('a browser visit through every state leaves the cookie jar empty, sets no cookie and reaches no other origin', async ({
    page,
    context,
    baseURL,
  }) => {
    const requested: string[] = [];
    const cookieHeaders: string[] = [];
    page.on('request', (req) => requested.push(req.url()));
    page.on('response', async (res) => {
      if ((await res.allHeaders())['set-cookie'] !== undefined) cookieHeaders.push(res.url());
    });
    for (const [, path] of STATES) {
      await page.goto(car(path));
      await expect(page.getByTestId('car-control')).toBeVisible();
      expect(await context.cookies(), path).toEqual([]);
    }
    expect(cookieHeaders).toEqual([]);
    expectNoForeignOrigin(requested, new URL(baseURL ?? '').origin);
  });

  test('the grouped page writes nothing to browser storage of its own', async ({ page }) => {
    await page.goto(car(rootUrl()));
    await expect(groups(page).first()).toBeVisible();
    const keys = await page.evaluate(() => [...Object.keys(window.localStorage), ...Object.keys(window.sessionStorage)]);
    // Only the car store of S5.7 may exist; the listing adds none.
    for (const key of keys) expect(['mi-coche']).toContain(key);
  });
});

test.describe('category page with a car: the slug is in no application log (AC 38 category side)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  const logs = (): string => {
    const result = spawnSync('docker', ['compose', 'logs', 'app', '--no-log-prefix'], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
  };

  test('browsing every grouped state, a past-the-end page and a no-match brand leaves no slug in the output', async ({ page, request }) => {
    expect(logs(), 'docker compose logs answered').toContain('Ready');
    const paths = [
      rootUrl(),
      rootUrl('?pagina=2'),
      rootUrl('?marca=mahle'),
      rootUrl('?marca=bosch'),
      airUrl(),
      airUrl('?marca=bosch'),
      airUrl('?marca=no-existe'),
      rootUrl('?pagina=99'),
    ];
    for (const path of paths) await request.get(car(path));
    await page.goto(car(rootUrl()));
    await expect(groups(page).first()).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = logs();
    for (const secret of [CAR.slug, encodeURIComponent(CAR.slug), 'coche=']) {
      expect(after.includes(secret), `the app container output holds ${secret}`).toBe(false);
    }
  });

  test('a past-the-end page with a car is a 404 and page 1 of an all-left-out brand is not', async ({ request }) => {
    expect((await request.get(car(rootUrl('?pagina=99')))).status()).toBe(404);
    expect((await request.get(car(airUrl('?marca=bosch')))).status()).toBe(200);
    // Page 2 exists for the root with the car (the combined list is 33 products), page 3 does not.
    expect((await request.get(car(rootUrl('?pagina=2')))).status()).toBe(200);
    expect((await request.get(car(rootUrl(`?pagina=${ROOT_PAGES + 1}`)))).status()).toBe(404);
  });
});
