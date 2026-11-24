
import { expect, test, type Locator, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { CAR, SAME_MODEL, UNKNOWN_SLUG, carName, cocheValues, fitCountsLine, queryOf } from '../support/car';
import { serviceLogs } from '../support/e2e-stack';
import { renderMessage } from '../support/messages';
import { expectNoForeignOrigin, expectNoSetCookie, openRawHtml } from '../support/page-checks';

// US-5.8 T5.8.3 (#277): the search page with a selected car, on the demo car (CAR). The cases are the ones
// the demo data reaches (measured on the demo database after one import):
//
//   q=filtro            34 public matches; with CAR 9 fit, 9 no data, 16 hidden (one page of 18)
//   q=bosch             2 fit, 0 no data, 4 hidden
//   q=mahle             0 fit, 1 no data, 5 hidden (the fits-empty note)
//   q=OF-1124 / EAN     one Mahle product no fitment of CAR names: listed as the exact hit, 0/0/0 + 1 exact
//   q=Mahle OF-1124     the same product by text only: left out, all left out (1 hidden)
//   q=bosch aire        two products, both left out for CAR: the all-left-out card (2 hidden)
//
// Elements are selected by the data-testid values of the frontend handoff (listing-group[-heading|-help],
// fit-mark, listing-note, search-summary, category-empty, fit-change-car) and by role for headings. The
// counts are literals from the demo data, kept as constants here; a change to the demo fitments fails them
// by design.

const PAGE_SIZE = 24;
const FILTRO = { fits: 9, unknown: 9, leftOut: 16 };
const FILTRO_NO_CAR = FILTRO.fits + FILTRO.unknown + FILTRO.leftOut;
const BOSCH = { fits: 2, unknown: 0, leftOut: 4 };
const MAHLE = { fits: 0, unknown: 1, leftOut: 5 };
const EXACT_CODE = 'OF-1124';
const EXACT_EAN = '2000000100203';
const ALL_OUT_TERM = 'bosch aire';
const ALL_OUT_HIDDEN = 2;

const carText = carName(CAR);
const searchUrl = (term: string, extra = ''): string => `/buscar?q=${encodeURIComponent(term)}${extra}`;
const withCar = (url: string, slug: string = CAR.slug): string => `${url}${url.includes('?') ? '&' : '?'}coche=${slug}`;
const prefix = (term: string): string => messages.Search.summaryCarPrefix.replace('{term}', term);
/** The whole counts line with a car: prefix, a space, then the parts of fitCountsLine. */
const carLine = (term: string, counts: Parameters<typeof fitCountsLine>[0], paged?: [number, number]): string =>
  `${prefix(term)} ${fitCountsLine(counts, paged)}`;

const groups = (page: Page) => page.getByTestId('listing-group');
const group = (page: Page, kind: 'fits' | 'unknown' | 'no-fit-exact') =>
  page.locator(`[data-testid="listing-group"][data-group="${kind}"]`);
const cardsIn = (scope: Locator) => scope.getByTestId('category-card');
const summary = (page: Page) => page.getByTestId('search-summary');
const panelInput = (page: Page) => page.getByTestId('search-panel').getByTestId('search-input');
const outline = (page: Page): Promise<string[]> =>
  page
    .locator('main')
    .locator('h1, h2, h3, h4, h5, h6')
    .evaluateAll((nodes) => nodes.map((node) => node.tagName.toLowerCase()));

test.describe('search page with a car: the grouped listing', () => {
  test('text term: the fits group, then the no-data group, marks and the counts line', async ({ page }) => {
    await page.goto(withCar(searchUrl('filtro')));
    await expect(page.getByTestId('car-label')).toBeVisible();

    await expect(groups(page)).toHaveCount(2);
    await expect(groups(page).nth(0)).toHaveAttribute('data-group', 'fits');
    await expect(groups(page).nth(1)).toHaveAttribute('data-group', 'unknown');
    await expect(group(page, 'fits').getByTestId('listing-group-heading')).toHaveText(
      messages.Fit.fitsHeading.replace('{car}', carText),
    );
    await expect(group(page, 'fits').getByTestId('listing-group-help')).toHaveCount(0);
    await expect(group(page, 'unknown').getByTestId('listing-group-heading')).toHaveText(messages.Fit.unknownHeading);
    await expect(group(page, 'unknown').getByTestId('listing-group-help')).toHaveText(messages.Fit.unknownHelp);
    await expect(cardsIn(group(page, 'fits'))).toHaveCount(FILTRO.fits);
    await expect(cardsIn(group(page, 'unknown'))).toHaveCount(FILTRO.unknown);

    const marks = group(page, 'fits').getByTestId('fit-mark');
    await expect(marks).toHaveCount(FILTRO.fits);
    for (const text of await marks.allTextContents()) expect(text.trim()).toBe(messages.Fit.markFits);
    await expect(marks.first()).toHaveAttribute('data-fit', 'fits');
    await expect(group(page, 'unknown').getByTestId('fit-mark')).toHaveCount(0);

    // The term, then three numbers, in place of the single product count; one page, so no indicator.
    await expect(summary(page)).toHaveText(carLine('filtro', FILTRO));
    await expect(page.getByTestId('pagination')).toHaveCount(0);
    await expect(page.getByTestId('listing-note')).toHaveCount(0);
  });

  test('the three numbers add up to the public matches the same term lists without a car', async ({ page }) => {
    await page.goto(searchUrl('filtro'));
    await expect(summary(page)).toContainText(`${FILTRO_NO_CAR} productos`);
    expect(FILTRO.fits + FILTRO.unknown + FILTRO.leftOut).toBe(FILTRO_NO_CAR);
  });

  test('the listing holds every fit and every no-data match once, no no-fit card, and the fits come first', async ({ page }) => {
    await page.goto(withCar(searchUrl('filtro')));
    const titles = await page.getByTestId('card-title').allTextContents();
    expect(titles).toHaveLength(FILTRO.fits + FILTRO.unknown);
    expect(new Set(titles).size).toBe(titles.length);
    await expect(page.getByTestId('fit-mark').filter({ hasText: messages.Fit.markNoFit })).toHaveCount(0);
    const order = await page
      .getByTestId('category-card')
      .evaluateAll((nodes) => nodes.map((node) => node.querySelector('[data-testid="fit-mark"]') !== null));
    expect(order.indexOf(false)).toBe(FILTRO.fits);
    expect(order.slice(FILTRO.fits).includes(true)).toBe(false);
  });

  test('outline: one h1, an h2 per group, an h3 per card', async ({ page }) => {
    await page.goto(withCar(searchUrl('filtro')));
    expect(await outline(page)).toEqual([
      'h1',
      'h2',
      ...Array<string>(FILTRO.fits).fill('h3'),
      'h2',
      ...Array<string>(FILTRO.unknown).fill('h3'),
    ]);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      messages.Fit.fitsHeading.replace('{car}', carText),
      messages.Fit.unknownHeading,
    ]);
  });

  test('a brand term with fits only shows the fits group alone, no note and no no-data heading', async ({ page }) => {
    await page.goto(withCar(searchUrl('bosch')));
    await expect(groups(page)).toHaveCount(1);
    await expect(groups(page).first()).toHaveAttribute('data-group', 'fits');
    await expect(cardsIn(group(page, 'fits'))).toHaveCount(BOSCH.fits);
    await expect(page.getByText(messages.Fit.unknownHeading, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('listing-note')).toHaveCount(0);
    await expect(summary(page)).toHaveText(carLine('bosch', BOSCH));
  });

  test('a term with no fits shows the note above the no-data group and no fits heading', async ({ page }) => {
    await page.goto(withCar(searchUrl('mahle')));
    const note = page.getByTestId('listing-note');
    await expect(note).toHaveText(messages.Fit.noFitsNote.replace('{car}', carText));
    await expect(note).toHaveAttribute('role', 'note');
    await expect(group(page, 'fits')).toHaveCount(0);
    await expect(groups(page)).toHaveCount(1);
    await expect(cardsIn(group(page, 'unknown'))).toHaveCount(MAHLE.unknown);
    await expect(page.getByTestId('fit-mark')).toHaveCount(0);
    const noteBeforeGroup = await page.evaluate(() => {
      const noteNode = document.querySelector('[data-testid="listing-note"]') as Node;
      const groupNode = document.querySelector('[data-testid="listing-group"]') as Node;
      return Boolean(noteNode.compareDocumentPosition(groupNode) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(noteBeforeGroup).toBe(true);
    await expect(summary(page)).toHaveText(carLine('mahle', MAHLE));
  });

  test('the term is kept in the page field and every card is a link to its product with the car', async ({ page }) => {
    await page.goto(withCar(searchUrl('filtro')));
    await expect(panelInput(page)).toHaveValue('filtro');
    const hrefs = await page.getByTestId('card-title').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(hrefs).toHaveLength(FILTRO.fits + FILTRO.unknown);
    for (const href of hrefs) expect(href).toMatch(/^\/producto\/[^?]+\?coche=/);
  });
});

test.describe('search page with a car: the exact-code exception (D-1)', () => {
  for (const [kind, term] of [
    ['part number', EXACT_CODE],
    ['EAN', EXACT_EAN],
  ] as const) {
    test(`a ${kind} that names a no-fit product lists it in the exact-hit group with the No compatible mark`, async ({ page }) => {
      await page.goto(withCar(searchUrl(term)));
      await expect(groups(page)).toHaveCount(1);
      await expect(groups(page).first()).toHaveAttribute('data-group', 'no-fit-exact');
      await expect(group(page, 'no-fit-exact').getByTestId('listing-group-heading')).toHaveText(messages.Fit.exactHeading);
      await expect(group(page, 'no-fit-exact').getByTestId('listing-group-help')).toHaveText(
        renderMessage(messages.Fit.exactHelp, { count: 1, car: carText }),
      );
      const cards = cardsIn(group(page, 'no-fit-exact'));
      await expect(cards).toHaveCount(1);
      await expect(cards.getByTestId('card-title')).toContainText(EXACT_CODE);
      const mark = cards.getByTestId('fit-mark');
      await expect(mark).toHaveText(messages.Fit.markNoFit);
      await expect(mark).toHaveAttribute('data-fit', 'no-fit');
      // The fourth part appears only when there is an exact hit; the other three are zero.
      await expect(summary(page)).toHaveText(carLine(term, { fits: 0, unknown: 0, leftOut: 0, exact: 1 }));
      // The card is a link to the product with the car, and the page is a results page, not the all-left-out card.
      await expect(cards.getByTestId('card-title')).toHaveAttribute('href', /\/producto\/[^?]+\?coche=/);
      await expect(page.getByTestId('category-empty')).toHaveCount(0);
      await expect(page.getByTestId('listing-note')).toHaveText(messages.Fit.noFitsNote.replace('{car}', carText));
    });
  }

  test('outline of the exact-hit group: h1, h2, h3', async ({ page }) => {
    await page.goto(withCar(searchUrl(EXACT_CODE)));
    expect(await outline(page)).toEqual(['h1', 'h2', 'h3']);
  });

  test('the same product reached by text only (a term that is not just its code) is left out', async ({ page }) => {
    await page.goto(withCar(searchUrl(`Mahle ${EXACT_CODE}`)));
    await expect(groups(page)).toHaveCount(0);
    await expect(page.getByTestId('fit-mark')).toHaveCount(0);
    await expect(page.getByTestId('category-empty')).toBeVisible();
    await expect(summary(page)).toHaveText(carLine(`Mahle ${EXACT_CODE}`, { fits: 0, unknown: 0, leftOut: 1 }));
  });

  test('the exact-hit group is not shown without a car, and its product is a plain card', async ({ page }) => {
    await page.goto(searchUrl(EXACT_CODE));
    await expect(groups(page)).toHaveCount(0);
    await expect(page.getByTestId('fit-mark')).toHaveCount(0);
    await expect(cardsIn(page.locator('main'))).toHaveCount(1);
  });
});

test.describe('search page with a car: all left out and the other empty states', () => {
  test('every match left out shows the all-left-out card with one action and the zero counts line', async ({ page }) => {
    await page.goto(withCar(searchUrl(ALL_OUT_TERM)));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(messages.Search.heading);
    const card = page.getByTestId('category-empty');
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(messages.Search.allOutHeading.replace('{car}', carText));
    // The body names the term and the hidden number; the heading never carries the term.
    await expect(card).toContainText(
      renderMessage(messages.Search.allOutBody, { count: ALL_OUT_HIDDEN, term: ALL_OUT_TERM }),
    );
    await expect(card.getByRole('heading', { level: 2 })).not.toContainText(ALL_OUT_TERM);
    // Not the no-results copy, and no category escape hatch: the only action changes the car.
    await expect(card).not.toContainText(messages.Search.noResultsHeading);
    await expect(card).not.toContainText(messages.Search.browseAction);
    await expect(card.locator('a')).toHaveCount(1);
    await expect(page.getByTestId('fit-change-car')).toHaveText(messages.Fit.changeCar);

    await expect(summary(page)).toHaveText(carLine(ALL_OUT_TERM, { fits: 0, unknown: 0, leftOut: ALL_OUT_HIDDEN }));
    await expect(groups(page)).toHaveCount(0);
    await expect(page.getByTestId('pagination')).toHaveCount(0);
    // The panel stays, with the term in the field.
    await expect(panelInput(page)).toHaveValue(ALL_OUT_TERM);
    expect(await outline(page)).toEqual(['h1', 'h2']);
  });

  test('the change-car action goes to the picker with the search as the way back', async ({ page }) => {
    await page.goto(withCar(searchUrl(ALL_OUT_TERM)));
    const href = (await page.getByTestId('fit-change-car').getAttribute('href')) ?? '';
    const target = new URL(href, 'http://h.invalid');
    expect(target.pathname).toBe('/mi-coche');
    expect(target.searchParams.get('marca')).toBe(CAR.makeSlug);
    expect(target.searchParams.get('modelo')).toBe(CAR.modelSlug);
    const back = new URL(target.searchParams.get('volver') ?? '', 'http://h.invalid');
    expect(back.pathname).toBe('/buscar');
    expect(queryOf(back.pathname + back.search)).toContainEqual(['q', ALL_OUT_TERM]);
    expect(cocheValues(href)).toEqual([]);
  });

  test('a term with no match at all is the no-results state, even with a car', async ({ page }) => {
    await page.goto(withCar(searchUrl('zqxvbnmw')));
    const card = page.getByTestId('category-empty');
    await expect(card).toContainText(messages.Search.noResultsHeading);
    await expect(card).not.toContainText(messages.Search.allOutHeading.replace('{car}', carText));
    await expect(page.getByTestId('fit-change-car')).toHaveCount(0);
    await expect(summary(page)).toHaveCount(0);
  });

  test('an empty query with a car is the prompt state', async ({ page }) => {
    await page.goto(withCar('/buscar'));
    await expect(page.getByTestId('category-empty')).toContainText(messages.Search.promptHeading);
    await expect(summary(page)).toHaveCount(0);
    await expect(groups(page)).toHaveCount(0);
  });

  test('a page past the end of the combined list is a 404; page 1 of an all-left-out term is not', async ({ request }) => {
    // Without a car "filtro" fills two pages; with the car only 18 are listed.
    expect((await request.get(searchUrl('filtro', '&pagina=2'))).status()).toBe(200);
    expect((await request.get(withCar(searchUrl('filtro', '&pagina=2')))).status()).toBe(404);
    expect((await request.get(withCar(searchUrl('filtro')))).status()).toBe(200);
    expect((await request.get(withCar(searchUrl(ALL_OUT_TERM)))).status()).toBe(200);
    expect((await request.get(withCar(searchUrl(ALL_OUT_TERM, '&pagina=2')))).status()).toBe(404);
  });
});

test.describe('search page with a car: the unchanged no-car page', () => {
  const unchanged: [string, string][] = [
    ['no car', searchUrl('filtro')],
    ['an unrecognised car', withCar(searchUrl('filtro'), UNKNOWN_SLUG)],
    ['a malformed car', searchUrl('filtro', '&coche=Mal%20Formado%21')],
  ];
  for (const [kind, path] of unchanged) {
    test(`${kind}: one grid of cards, the single product count, no heading, no mark, no note`, async ({ page }) => {
      await page.goto(path);
      const pages = Math.ceil(FILTRO_NO_CAR / PAGE_SIZE);
      await expect(summary(page)).toHaveText(
        renderMessage(messages.Search.summaryPaged, { count: FILTRO_NO_CAR, term: 'filtro', page: 1, pages }),
      );
      await expect(groups(page)).toHaveCount(0);
      await expect(page.getByTestId('fit-mark')).toHaveCount(0);
      await expect(page.getByTestId('listing-note')).toHaveCount(0);
      await expect(page.getByTestId('listing-group-heading')).toHaveCount(0);
      await expect(page.getByTestId('category-card')).toHaveCount(PAGE_SIZE);
      const levels = await outline(page);
      expect(levels[0]).toBe('h1');
      expect(new Set(levels.slice(1))).toEqual(new Set(['h2']));
      expect(await page.getByTestId('card-title').evaluateAll((nodes) => nodes.filter((node) => node.hasAttribute('aria-describedby')).length)).toBe(0);
    });
  }

  test('an exact code without a car or with an unrecognised car is a plain card and no exact group', async ({ page }) => {
    for (const path of [searchUrl(EXACT_EAN), withCar(searchUrl(EXACT_EAN), UNKNOWN_SLUG)]) {
      await page.goto(path);
      await expect(page.getByTestId('fit-mark')).toHaveCount(0);
      await expect(groups(page)).toHaveCount(0);
      await expect(cardsIn(page.locator('main'))).toHaveCount(1);
    }
  });

  test('without a car the all-left-out term is a plain two-card listing', async ({ page }) => {
    await page.goto(searchUrl(ALL_OUT_TERM));
    await expect(cardsIn(page.locator('main'))).toHaveCount(ALL_OUT_HIDDEN);
    await expect(page.getByTestId('fit-change-car')).toHaveCount(0);
  });
});

/** The search states the link crawl reads: every state with something to link. */
const CAR_PAGES: [string, string][] = [
  ['grouped results', searchUrl('filtro')],
  ['fits only', searchUrl('bosch')],
  ['note and no-data group', searchUrl('mahle')],
  ['exact hit', searchUrl(EXACT_CODE)],
  ['all left out', searchUrl(ALL_OUT_TERM)],
  ['no results', searchUrl('zqxvbnmw')],
  ['empty query', '/buscar'],
];

/** The car-select, car-change, car-remove actions and the all-left-out change action: the picker's own links. */
const PICKER_ACTIONS = new Set(['car-select', 'car-change', 'car-remove', 'fit-change-car']);

test.describe('search page with a car: every link and form keeps coche', () => {
  for (const [name, path] of CAR_PAGES) {
    test(`${name}: every internal anchor but /go and the picker actions ends in coche=<slug>, once`, async ({ page }) => {
      await page.goto(withCar(path));
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
      expect(carried.length, name).toBeGreaterThanOrEqual(2);
      for (const anchor of carried) {
        expect(cocheValues(anchor.href), `${name}: ${anchor.href}`).toEqual([CAR.slug]);
        expect(queryOf(anchor.href).at(-1), `${name}: ${anchor.href}`).toEqual(['coche', CAR.slug]);
      }
      for (const anchor of anchors.filter((item) => item.testid === 'fit-change-car')) {
        expect(cocheValues(anchor.href), anchor.href).toEqual([]);
      }
      // The page search form carries the car as a hidden input, once.
      const hidden = await page
        .getByTestId('search-panel')
        .locator('input[type="hidden"][name="coche"]')
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
      expect(hidden, name).toEqual([CAR.slug]);
    });
  }

  test('submitting the page form with a new term keeps the car and shows the grouped view', async ({ page }) => {
    await page.goto(withCar(searchUrl('filtro')));
    await panelInput(page).fill('bosch');
    await page.getByTestId('search-panel').getByTestId('search-button').click();
    await page.waitForURL((url) => url.searchParams.get('q') === 'bosch');
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    await expect(summary(page)).toHaveText(carLine('bosch', BOSCH));
  });
});

test.describe('search page with a car: JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('the grouped view, marks, counts and note are in the server HTML', async ({ page }) => {
    await page.goto(withCar(searchUrl('filtro')));
    await expect(groups(page)).toHaveCount(2);
    await expect(page.getByTestId('fit-mark')).toHaveCount(FILTRO.fits);
    await expect(summary(page)).toHaveText(carLine('filtro', FILTRO));
    await page.goto(withCar(searchUrl('mahle')));
    await expect(page.getByTestId('listing-note')).toBeVisible();
  });

  test('the exact-hit group and the all-left-out card render', async ({ page }) => {
    await page.goto(withCar(searchUrl(EXACT_CODE)));
    await expect(group(page, 'no-fit-exact')).toBeVisible();
    await expect(page.getByTestId('fit-mark')).toHaveText(messages.Fit.markNoFit);
    await page.goto(withCar(searchUrl(ALL_OUT_TERM)));
    await expect(page.getByTestId('category-empty')).toBeVisible();
    await expect(page.getByTestId('fit-change-car')).toBeVisible();
  });

  test('Cambiar de coche leads through the picker steps and back to the same search with the new car', async ({ page, context }) => {
    await page.goto(withCar(searchUrl(ALL_OUT_TERM)));
    await page.getByTestId('fit-change-car').click();
    await page.waitForURL((url) => url.pathname === '/mi-coche');
    await expect(page.getByTestId('car-picker-step')).toHaveAttribute('data-step', '3');
    await page.getByTestId('car-picker-option').filter({ hasText: SAME_MODEL.engine }).first().click();
    await page.waitForURL((url) => url.pathname === '/buscar');
    expect(new URL(page.url()).searchParams.get('q')).toBe(ALL_OUT_TERM);
    expect(cocheValues(page.url())).toEqual([SAME_MODEL.slug]);
    await expect(page.getByTestId('car-label')).toContainText(SAME_MODEL.engine);
    expect(await context.cookies()).toEqual([]);
  });

  test('the page form submits with the car and the term', async ({ page }) => {
    await page.goto(withCar(searchUrl('filtro')));
    await panelInput(page).fill('bosch');
    await page.getByTestId('search-panel').getByTestId('search-button').click();
    await page.waitForURL((url) => url.searchParams.get('q') === 'bosch');
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    await expect(groups(page).first()).toHaveAttribute('data-group', 'fits');
  });
});

test.describe('search page with a car: indexing, cookies and storage', () => {
  const STATES: [string, string][] = [
    ['grouped results', searchUrl('filtro')],
    ['exact hit', searchUrl(EXACT_CODE)],
    ['all left out', searchUrl(ALL_OUT_TERM)],
    ['no results', searchUrl('zqxvbnmw')],
    ['empty query', '/buscar'],
  ];

  for (const [name, path] of STATES) {
    test(`${name}: noindex, no canonical, same-origin referrer policy, no Set-Cookie`, async ({ request, browser }) => {
      const response = await request.get(withCar(path), { maxRedirects: 0 });
      expect(response.status()).toBe(200);
      expectNoSetCookie(response);
      expect(response.headers()['referrer-policy']).toBe('same-origin');
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
      await page.goto(withCar(path));
      await expect(page.getByTestId('car-control')).toBeVisible();
      expect(await context.cookies(), path).toEqual([]);
    }
    expect(cookieHeaders).toEqual([]);
    expectNoForeignOrigin(requested, new URL(baseURL ?? '').origin);
  });

  test('the grouped page writes nothing to browser storage of its own', async ({ page }) => {
    await page.goto(withCar(searchUrl('filtro')));
    await expect(groups(page).first()).toBeVisible();
    const keys = await page.evaluate(() => [...Object.keys(window.localStorage), ...Object.keys(window.sessionStorage)]);
    for (const key of keys) expect(['mi-coche']).toContain(key);
  });
});

test.describe('search page with a car: the car slug is in no application log', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  const logs = (): string => serviceLogs('app');

  test('browsing every grouped state and a past-the-end page leaves no slug in the output', async ({ page, request }) => {
    expect(logs(), 'docker compose logs answered').toContain('Ready');
    const paths = [
      searchUrl('filtro'),
      searchUrl('bosch'),
      searchUrl('mahle'),
      searchUrl(EXACT_CODE),
      searchUrl(EXACT_EAN),
      searchUrl(ALL_OUT_TERM),
      searchUrl('zqxvbnmw'),
      searchUrl('filtro', '&pagina=99'),
    ];
    for (const path of paths) await request.get(withCar(path));
    await page.goto(withCar(searchUrl('filtro')));
    await expect(groups(page).first()).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = logs();
    for (const secret of [CAR.slug, encodeURIComponent(CAR.slug), 'coche=']) {
      expect(after.includes(secret), `the app container output holds ${secret}`).toBe(false);
    }
  });
});
