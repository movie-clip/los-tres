import { expect, test, type Browser, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { VEHICLE_CATALOGUE, type VehicleEntry } from '../../src/db/vehicle-catalogue';
import { DEMO_BOSCH, DEMO_SHARED } from '../fixtures/demo';
import {
  CAR,
  CAR_STORAGE_KEY,
  LONGEST_CAR,
  OTHER_MAKE,
  SAME_MODEL,
  UNKNOWN_SLUG,
  carName,
  cocheValues,
  engineDetail,
  queryOf,
  seedStorage,
  storageOf,
} from '../support/car';
import { normaliseSpaces, renderMessage } from '../support/messages';
import { expectNoSetCookie } from '../support/page-checks';

// US-5.9 T5.9.2 (#280): the list of compatible vehicles on the product page, against the Compose stack.
// The collapse is reachable because the demo Bosch filter fits 12 vehicles (DEMO_BOSCH, D-2): ten shown,
// two behind a native details. Everything is proven with JavaScript on and off (AC 20, 28): the list is
// server HTML and the control is native. Reflow for the closed and open list is in reflow.spec.ts.

const MAHLE_OIL = 'demo-filtro-de-aceite-mahle-of-1124';
const MANN_AIR = 'demo-filtro-de-aire-mann-filter-af-1318-275-200-mm';
const CATEGORY = '/categoria/filtros-de-aceite';

const urlOf = (slug: string, coche?: string): string =>
  `/producto/${slug}${coche === undefined ? '' : `?coche=${coche}`}`;

const entryOf = (slug: string): VehicleEntry => {
  const entry = VEHICLE_CATALOGUE.find((item) => item.slug === slug);
  if (entry === undefined) throw new Error(`the vehicle list has no ${slug}`);
  return entry;
};

const BOSCH_ENTRIES = DEMO_BOSCH.vehicles.map(entryOf);
const VISIBLE = 10;

const groupNameOf = (entry: VehicleEntry): string =>
  messages.ProductFit.groupName
    .replace('{make}', entry.make)
    .replace('{model}', entry.model)
    .replace('{generation}', entry.generation)
    .trim();

const yearsOf = (entry: VehicleEntry): string =>
  entry.yearTo === null
    ? messages.CarPicker.yearsOngoing.replace('{from}', String(entry.yearFrom))
    : messages.CarPicker.years.replace('{from}', String(entry.yearFrom)).replace('{to}', String(entry.yearTo));

const detailOf = (entry: VehicleEntry): string =>
  messages.ProductFit.rowDetail.replace('{fuelPower}', engineDetail(entry)).replace('{years}', yearsOf(entry));

/** Group names of neighbouring entries, in order, one per run of the same model slug. */
function groupsOf(entries: VehicleEntry[]): string[] {
  const names: string[] = [];
  let last: string | null = null;
  for (const entry of entries) {
    if (entry.modelSlug !== last) names.push(groupNameOf(entry));
    last = entry.modelSlug;
  }
  return names;
}

const SHOWN_GROUPS = groupsOf(BOSCH_ENTRIES.slice(0, VISIBLE));
const REST_GROUPS = groupsOf(BOSCH_ENTRIES.slice(VISIBLE));
const MORE_LABEL = renderMessage(messages.ProductFit.moreVehicles, { count: BOSCH_ENTRIES.length - VISIBLE });
const FEWER_LABEL = messages.ProductFit.fewerVehicles;

const list = (page: Page) => page.getByTestId('vehicle-list');
const rows = (page: Page) => page.getByTestId('vehicle-list-row');
const more = (page: Page) => page.getByTestId('vehicle-list-more');
const toggle = (page: Page) => page.getByTestId('vehicle-list-toggle');
const tags = (page: Page) => page.getByTestId('vehicle-list-your-car');
const banner = (page: Page) => page.getByTestId('fit-banner');
const norm = (value: string | null): string => normaliseSpaces((value ?? '').replace(/\s+/g, ' ').trim());

async function withoutScript<T>(browser: Browser, baseURL: string | undefined, run: (page: Page) => Promise<T>) {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

const hrefsOf = (page: Page) => rows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));

for (const mode of ['with JavaScript', 'with JavaScript off'] as const) {
  test.describe(`the extended demo product ${mode} (ACs 12, 14, 16 to 20, 28, 31)`, () => {
    async function open(page: Page, browser: Browser, baseURL: string | undefined, url: string, run: (page: Page) => Promise<void>) {
      if (mode === 'with JavaScript') {
        await page.goto(url);
        await run(page);
      } else {
        await withoutScript(browser, baseURL, async (plain) => {
          await plain.goto(url);
          await run(plain);
        });
      }
    }

    test('shows the card with its heading and help, ten tiles and a closed control with the count of the rest', async ({
      page,
      browser,
      baseURL,
    }) => {
      await open(page, browser, baseURL, urlOf(DEMO_BOSCH.slug), async (shown) => {
        await expect(list(shown)).toHaveCount(1);
        await expect(list(shown).getByRole('heading', { level: 2 })).toHaveText(messages.ProductFit.listHeading);
        await expect(list(shown).locator('p').first()).toHaveText(messages.ProductFit.listHelp);

        await expect(rows(shown)).toHaveCount(BOSCH_ENTRIES.length);
        await expect(rows(shown).filter({ visible: true })).toHaveCount(VISIBLE);
        // The two behind the control are in the page (AC 20) but not shown.
        await expect(more(shown)).toHaveCount(1);
        await expect(more(shown).getByTestId('vehicle-list-row')).toHaveCount(BOSCH_ENTRIES.length - VISIBLE);
        await expect(more(shown)).not.toHaveAttribute('open', /.*/);
        for (const hidden of await more(shown).getByTestId('vehicle-list-row').all()) await expect(hidden).toBeHidden();

        // The control names how many more there are, and shows one label only.
        await expect(toggle(shown)).toBeVisible();
        expect(norm(await toggle(shown).innerText())).toBe(norm(MORE_LABEL));
        expect(MORE_LABEL).toContain(String(BOSCH_ENTRIES.length - VISIBLE));
      });
    });

    test('the tiles follow the vehicle list order, one per vehicle, each a link to the category for its own vehicle', async ({
      page,
      browser,
      baseURL,
    }) => {
      await open(page, browser, baseURL, urlOf(DEMO_BOSCH.slug), async (shown) => {
        expect(await hrefsOf(shown)).toEqual(DEMO_BOSCH.vehicles.map((slug) => `${CATEGORY}?coche=${slug}`));
        const positions = BOSCH_ENTRIES.map((entry) => entry.position);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(new Set(await hrefsOf(shown)).size).toBe(DEMO_BOSCH.vehicles.length);
      });
    });

    test('group headings: one per make, model and generation, the straddling group twice, a hidden-only group only inside the control', async ({
      page,
      browser,
      baseURL,
    }) => {
      await open(page, browser, baseURL, urlOf(DEMO_BOSCH.slug), async (shown) => {
        // Closed: only the headings of groups that show a tile (AC 19, check 17).
        const all = list(shown).locator('h3');
        await expect(all).toHaveCount(SHOWN_GROUPS.length + REST_GROUPS.length);
        expect((await all.allTextContents()).map(norm)).toEqual([...SHOWN_GROUPS, ...REST_GROUPS].map(norm));
        const visibleClosed = (await all.filter({ visible: true }).allTextContents()).map(norm);
        expect(visibleClosed).toEqual(SHOWN_GROUPS.map(norm));

        // The group that straddles the tenth tile is the one repeated, with the same text (check 18).
        const straddling = SHOWN_GROUPS.filter((name) => REST_GROUPS.includes(name));
        expect(straddling).toEqual([groupNameOf(entryOf(DEMO_BOSCH.vehicles[VISIBLE - 1]))]);
        const hiddenOnly = REST_GROUPS.filter((name) => !SHOWN_GROUPS.includes(name));
        expect(hiddenOnly.length).toBeGreaterThan(0);
        for (const name of hiddenOnly) {
          await expect(list(shown).locator('h3').filter({ hasText: name }).filter({ visible: true })).toHaveCount(0);
        }

        await toggle(shown).click();
        const visibleOpen = (await all.filter({ visible: true }).allTextContents()).map(norm);
        expect(visibleOpen).toEqual([...SHOWN_GROUPS, ...REST_GROUPS].map(norm));
      });
    });

    test('opening shows every tile and the label "Mostrar menos"; closing restores it; the page does not move sideways', async ({
      page,
      browser,
      baseURL,
    }) => {
      await open(page, browser, baseURL, urlOf(DEMO_BOSCH.slug), async (shown) => {
        await toggle(shown).click();
        await expect(more(shown)).toHaveAttribute('open', /.*/);
        await expect(rows(shown).filter({ visible: true })).toHaveCount(BOSCH_ENTRIES.length);
        expect(norm(await toggle(shown).innerText())).toBe(norm(FEWER_LABEL));
        expect(await shown.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

        await toggle(shown).click();
        await expect(more(shown)).not.toHaveAttribute('open', /.*/);
        await expect(rows(shown).filter({ visible: true })).toHaveCount(VISIBLE);
        expect(norm(await toggle(shown).innerText())).toBe(norm(MORE_LABEL));
      });
    });

    test('the control works from the keyboard: Enter opens it and Space closes it (AC 31)', async ({ page, browser, baseURL }) => {
      await open(page, browser, baseURL, urlOf(DEMO_BOSCH.slug), async (shown) => {
        await toggle(shown).focus();
        await expect(toggle(shown)).toBeFocused();
        await shown.keyboard.press('Enter');
        await expect(more(shown)).toHaveAttribute('open', /.*/);
        await expect(rows(shown).filter({ visible: true })).toHaveCount(BOSCH_ENTRIES.length);
        await shown.keyboard.press('Space');
        await expect(more(shown)).not.toHaveAttribute('open', /.*/);
        // Closed, the extra tiles are not in the tab order: Tab from the control leaves the card or goes on, never into them.
        await toggle(shown).focus();
        await shown.keyboard.press('Tab');
        const inside = await shown.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="vehicle-list-more"]')));
        expect(inside).toBe(false);
      });
    });

    test('the control tells assistive technology whether the rest is shown, with no script and no aria-expanded to keep in step (AC 31)', async ({
      page,
      browser,
      baseURL,
    }) => {
      await open(page, browser, baseURL, urlOf(DEMO_BOSCH.slug), async (shown) => {
        // A native summary of a details: the state is the details' own, and the page writes no aria-expanded.
        expect(await toggle(shown).evaluate((node) => node.tagName)).toBe('SUMMARY');
        expect(await more(shown).evaluate((node) => node.tagName)).toBe('DETAILS');
        await expect(toggle(shown)).not.toHaveAttribute('aria-expanded', /.*/);
        // The label that is not current is out of the accessibility tree (display none), so one name is read.
        const hiddenLabels = await toggle(shown).evaluate((node) =>
          [...node.querySelectorAll('span')].filter((span) => getComputedStyle(span).display === 'none').length,
        );
        expect(hiddenLabels).toBe(1);
        await toggle(shown).click();
        const hiddenOpen = await toggle(shown).evaluate((node) =>
          [...node.querySelectorAll('span')].filter((span) => getComputedStyle(span).display === 'none').map((span) => span.textContent),
        );
        expect(hiddenOpen).toHaveLength(1);
        expect(norm(hiddenOpen[0])).toBe(norm(MORE_LABEL));
      });
    });

    test('no two tiles read the same: each shows its engine and its fuel, power and years (AC 17)', async ({ page, browser, baseURL }) => {
      await open(page, browser, baseURL, urlOf(DEMO_BOSCH.slug), async (shown) => {
        const texts = (await rows(shown).evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''))).map(norm);
        expect(texts).toHaveLength(BOSCH_ENTRIES.length);
        expect(new Set(texts).size).toBe(texts.length);
        for (const [index, entry] of BOSCH_ENTRIES.entries()) {
          expect(texts[index], entry.slug).toContain(norm(entry.engine));
          expect(texts[index], entry.slug).toContain(norm(detailOf(entry)));
          // The tile's name starts with its group's name, so a list of links read out of context is unambiguous.
          expect(texts[index], entry.slug).toContain(norm(groupNameOf(entry)));
        }
        // The long engine label the design asks for is on the page.
        expect(texts.some((text) => text.includes('EcoBoost Hybrid'))).toBe(true);
      });
    });

    test('the heading outline: h1, "Dónde comprarlo", the list h2 with its h3s, then "Descripción"; the card sits between the offers and the description (AC 31)', async ({
      page,
      browser,
      baseURL,
    }) => {
      await open(page, browser, baseURL, urlOf(DEMO_BOSCH.slug, CAR.slug), async (shown) => {
        const outline = await shown.locator('main').evaluate((main) =>
          [...main.querySelectorAll('h1, h2, h3')].map((node) => ({ level: Number(node.tagName[1]), text: (node.textContent ?? '').trim() })),
        );
        const h2s = outline.filter((item) => item.level === 2).map((item) => norm(item.text));
        expect(h2s).toEqual([messages.Product.offersHeading, messages.ProductFit.listHeading, messages.Product.descriptionHeading].map(norm));
        const at = outline.findIndex((item) => item.level === 2 && norm(item.text) === norm(messages.ProductFit.listHeading));
        const afterList = outline.slice(at + 1);
        const groupCount = SHOWN_GROUPS.length + REST_GROUPS.length;
        expect(afterList.slice(0, groupCount).every((item) => item.level === 3)).toBe(true);
        expect(afterList[groupCount]).toMatchObject({ level: 2 });
        expect(outline.filter((item) => item.level === 3)).toHaveLength(groupCount);
        // The banner comes before the offers, the card after the offers and before the description.
        const order = await shown.evaluate(() => {
          const at = (selector: string) => document.querySelector(selector)!;
          const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
          const offers = [...document.querySelectorAll('[data-testid="offer-go"]')];
          return {
            offersBeforeList: before(offers[offers.length - 1], at('[data-testid="vehicle-list"]')),
            listBeforeDescription: before(at('[data-testid="vehicle-list"]'), at('[data-testid="product-description"]')),
            bannerBeforeOffers: before(at('[data-testid="fit-banner"]'), offers[0]),
          };
        });
        expect(order).toEqual({ offersBeforeList: true, listBeforeDescription: true, bannerBeforeOffers: true });
      });
    });
  });
}

test.describe('the first HTML holds the whole list (AC 20)', () => {
  test('all 12 tiles are in the served HTML, two of them inside a closed details, with no script needed', async ({ request }) => {
    const response = await request.get(urlOf(DEMO_BOSCH.slug));
    expect(response.status()).toBe(200);
    expectNoSetCookie(response);
    const html = await response.text();
    expect(html.match(/data-testid="vehicle-list-row"/g)).toHaveLength(BOSCH_ENTRIES.length);
    expect(html.match(/<details/g)).toHaveLength(1);
    const at = html.indexOf('<details');
    const end = html.indexOf('</details>', at);
    expect(end).toBeGreaterThan(at);
    expect(html.slice(at, end).match(/data-testid="vehicle-list-row"/g)).toHaveLength(BOSCH_ENTRIES.length - VISIBLE);
    for (const [index, slug] of DEMO_BOSCH.vehicles.entries()) {
      const where = html.indexOf(`coche=${slug}"`);
      expect(where, slug).toBeGreaterThan(-1);
      expect(where > at && where < end, `${slug} is ${index < VISIBLE ? 'outside' : 'inside'} the details`).toBe(index >= VISIBLE);
    }
  });
});

test.describe('who sees the list, and when (ACs 12, 13, 15; L1, L3 to L5, L9 to L12)', () => {
  type Visitor = { name: string; coche: string | undefined; banner: string | null; tag: string | null };
  const visitors: Visitor[] = [
    { name: 'no car', coche: undefined, banner: null, tag: null },
    { name: 'an unrecognised car', coche: UNKNOWN_SLUG, banner: null, tag: null },
    { name: 'a malformed coche', coche: 'NO%20ES%20UN%20SLUG', banner: null, tag: null },
    { name: 'a car in the list (León 1.6 TDI)', coche: CAR.slug, banner: 'fits', tag: CAR.slug },
    { name: 'another car in the list (Golf 1.6 TDI)', coche: OTHER_MAKE.slug, banner: 'fits', tag: OTHER_MAKE.slug },
    { name: 'a car in the list that is not the demo car (León 1.4 TSI)', coche: SAME_MODEL.slug, banner: 'fits', tag: SAME_MODEL.slug },
    { name: 'a car that fits nothing (the longest label)', coche: LONGEST_CAR.slug, banner: 'no-fit', tag: null },
  ];

  for (const visitor of visitors) {
    test(`${visitor.name}: the same twelve tiles, the banner ${visitor.banner ?? 'absent'}, ${visitor.tag === null ? 'no' : 'one'} "Tu coche" tag`, async ({
      page,
    }) => {
      await page.goto(urlOf(DEMO_BOSCH.slug, visitor.coche));
      await expect(list(page)).toHaveCount(1);
      await expect(rows(page)).toHaveCount(BOSCH_ENTRIES.length);
      // The tile links are the row's own vehicle, not the selected car, for every visitor (AC 18).
      expect(await hrefsOf(page)).toEqual(DEMO_BOSCH.vehicles.map((slug) => `${CATEGORY}?coche=${slug}`));
      if (visitor.banner === null) {
        await expect(banner(page)).toHaveCount(0);
      } else {
        await expect(banner(page)).toHaveAttribute('data-fit', visitor.banner);
      }
      if (visitor.tag === null) {
        await expect(tags(page)).toHaveCount(0);
      } else {
        // AC 15: the fits banner appears exactly when the list holds the car, and that tile carries the tag.
        await expect(tags(page)).toHaveCount(1);
        await expect(tags(page)).toHaveText(messages.ProductFit.yourCar);
        const marked = rows(page).filter({ has: tags(page) });
        await expect(marked).toHaveCount(1);
        expect(cocheValues((await marked.getAttribute('href')) ?? '')).toEqual([visitor.tag]);
      }
    });
  }

  test('a selected car behind the control: the tag is there but hidden, the list does not open by itself, and it shows once opened (L11)', async ({
    page,
  }) => {
    const last = DEMO_BOSCH.vehicles[DEMO_BOSCH.vehicles.length - 1];
    await page.goto(urlOf(DEMO_BOSCH.slug, last));
    await expect(banner(page)).toHaveAttribute('data-fit', 'fits');
    await expect(more(page)).not.toHaveAttribute('open', /.*/);
    await expect(tags(page)).toHaveCount(1);
    await expect(tags(page)).toBeHidden();
    expect(await more(page).locator('[data-testid="vehicle-list-your-car"]').count()).toBe(1);
    await toggle(page).click();
    await expect(tags(page)).toBeVisible();
    const marked = rows(page).filter({ has: tags(page) });
    expect(cocheValues((await marked.getAttribute('href')) ?? '')).toEqual([last]);
  });

  test('a car outside the list shows no tag; the banner says no-fit and the list still lists the product vehicles (L10)', async ({
    page,
  }) => {
    await page.goto(urlOf(DEMO_BOSCH.slug, 'toyota-corolla-e210-2019-1-8-hybrid-122cv'));
    await expect(banner(page)).toHaveAttribute('data-fit', 'no-fit');
    await expect(tags(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(BOSCH_ENTRIES.length);
  });

  test('a product with no counted fitment shows no card, no heading and no help text, with and without a car (L1, AC 13)', async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    for (const url of [urlOf(DEMO_SHARED.slug), urlOf(DEMO_SHARED.slug, CAR.slug), urlOf(DEMO_SHARED.slug, UNKNOWN_SLUG)]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(list(page)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: messages.ProductFit.listHeading })).toHaveCount(0);
      await expect(page.locator('main h3')).toHaveCount(0);
      await expect(page.getByText(messages.ProductFit.listHelp)).toHaveCount(0);
      const html = await (await request.get(url)).text();
      expect(html).not.toContain('vehicle-list');
    }
    await withoutScript(browser, baseURL, async (plain) => {
      await plain.goto(urlOf(DEMO_SHARED.slug, CAR.slug));
      await expect(list(plain)).toHaveCount(0);
      await expect(banner(plain)).toHaveAttribute('data-fit', 'unknown');
    });
  });

  test('one vehicle: the card with one heading, one tile and no control (L3)', async ({ page }) => {
    await page.goto(urlOf(MAHLE_OIL));
    await expect(list(page)).toHaveCount(1);
    await expect(rows(page)).toHaveCount(1);
    await expect(list(page).locator('h3')).toHaveCount(1);
    await expect(more(page)).toHaveCount(0);
    await expect(toggle(page)).toHaveCount(0);
    await expect(page.locator('details')).toHaveCount(0);
  });

  test('three vehicles: three tiles in list order and no control (L4)', async ({ page }) => {
    await page.goto(urlOf(MANN_AIR));
    await expect(list(page)).toHaveCount(1);
    await expect(rows(page)).toHaveCount(3);
    await expect(more(page)).toHaveCount(0);
    const hrefs = await hrefsOf(page);
    const positions = hrefs.map((href) => entryOf(cocheValues(href)[0]).position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

test.describe('the links of the list (ACs 18, 22, 23)', () => {
  test('every tile is a plain anchor: coche is its own vehicle and the only parameter, rel nofollow, no target, whatever the car', async ({
    page,
  }) => {
    for (const coche of [undefined, UNKNOWN_SLUG, CAR.slug, LONGEST_CAR.slug]) {
      await page.goto(urlOf(DEMO_BOSCH.slug, coche));
      const anchors = await rows(page).evaluateAll((nodes) =>
        nodes.map((node) => ({
          href: node.getAttribute('href') ?? '',
          rel: node.getAttribute('rel'),
          target: node.getAttribute('target'),
          referrerpolicy: node.getAttribute('referrerpolicy'),
        })),
      );
      expect(anchors).toHaveLength(BOSCH_ENTRIES.length);
      for (const [index, anchor] of anchors.entries()) {
        const slug = DEMO_BOSCH.vehicles[index];
        expect(anchor.href, `${coche}`).toBe(`${CATEGORY}?coche=${slug}`);
        expect(queryOf(anchor.href)).toEqual([['coche', slug]]);
        expect(anchor.rel).toBe('nofollow');
        expect(anchor.target).toBeNull();
        expect(anchor.referrerpolicy).toBeNull();
      }
    }
  });

  test('the only links whose coche is not the selected car are the tiles; the others keep it, and /go has none', async ({ page }) => {
    await page.goto(urlOf(DEMO_BOSCH.slug, LONGEST_CAR.slug));
    const links = await page.locator('a[href]').evaluateAll((nodes) =>
      nodes.map((node) => ({ href: node.getAttribute('href') ?? '', testid: node.getAttribute('data-testid') })),
    );
    const internal = links.filter((link) => link.href.startsWith('/') && !link.href.startsWith('//'));
    const tiles = internal.filter((link) => link.testid === 'vehicle-list-row');
    expect(tiles).toHaveLength(BOSCH_ENTRIES.length);
    const others = internal.filter(
      (link) => link.testid !== 'vehicle-list-row' && !link.href.startsWith('/go/') && !['car-select', 'car-change', 'car-remove'].includes(link.testid ?? ''),
    );
    expect(others.length).toBeGreaterThanOrEqual(4);
    for (const link of others) expect(cocheValues(link.href), link.href).toEqual([LONGEST_CAR.slug]);
    for (const link of internal.filter((item) => item.href.startsWith('/go/'))) expect(link.href).not.toContain('?');
  });

  test('following a tile lands on the category for that vehicle and names that car in the header, with JavaScript off too', async ({
    page,
    browser,
    baseURL,
  }) => {
    const golf = OTHER_MAKE;
    await page.goto(urlOf(DEMO_BOSCH.slug));
    await page.locator(`a[data-testid="vehicle-list-row"][href$="coche=${golf.slug}"]`).click();
    await page.waitForURL((url) => url.pathname === CATEGORY);
    expect(queryOf(page.url())).toEqual([['coche', golf.slug]]);
    await expect(page.getByRole('banner')).toContainText(carName(golf));

    await withoutScript(browser, baseURL, async (plain) => {
      await plain.goto(urlOf(DEMO_BOSCH.slug, CAR.slug));
      await plain.locator(`a[data-testid="vehicle-list-row"][href$="coche=${golf.slug}"]`).click();
      await plain.waitForURL((url) => url.pathname === CATEGORY);
      expect(queryOf(plain.url())).toEqual([['coche', golf.slug]]);
      await expect(plain.getByRole('banner')).toContainText(carName(golf));
    });
  });

  test('following a tile writes no stored car: storage holds what it held before (AC 23)', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await seedStorage(page, CAR.slug);
    await page.goto(urlOf(DEMO_BOSCH.slug));
    // The S5.7 script adds the stored car to the URL (AC 11 of S5.9); the stored value is the demo car.
    await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });

    await page.locator(`a[data-testid="vehicle-list-row"][href$="coche=${OTHER_MAKE.slug}"]`).click();
    await page.waitForURL((url) => url.pathname === CATEGORY);
    expect(cocheValues(page.url())).toEqual([OTHER_MAKE.slug]);
    await expect(page.getByRole('banner')).toContainText(carName(OTHER_MAKE));
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });
    expect(await context.cookies()).toEqual([]);
    await context.close();
  });

  test('with no stored car, following a tile stores nothing and sets no cookie', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto(urlOf(DEMO_BOSCH.slug));
    await page.locator(`a[data-testid="vehicle-list-row"][href$="coche=${CAR.slug}"]`).click();
    await page.waitForURL((url) => url.pathname === CATEGORY);
    expect(await storageOf(page)).toEqual({});
    expect(await context.cookies()).toEqual([]);
    await context.close();
  });
});

test.describe('what stays the same with the list (ACs 24, 25, 27)', () => {
  test('the JSON-LD carries no vehicle information, and a response with the list sets no cookie', async ({ request }) => {
    const response = await request.get(urlOf(DEMO_BOSCH.slug, CAR.slug));
    expectNoSetCookie(response);
    const html = await response.text();
    const blocks = [...html.matchAll(/<script[^>]* type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    expect(blocks).toHaveLength(1);
    const text = blocks[0].toLowerCase();
    for (const entry of BOSCH_ENTRIES) {
      for (const word of [entry.slug, entry.make, entry.model, entry.engine]) expect(text, word).not.toContain(word.toLowerCase());
    }
  });

  test('with the list the page stays noindex with no canonical, with and without a car', async ({ request }) => {
    for (const coche of [undefined, CAR.slug]) {
      const html = await (await request.get(urlOf(DEMO_BOSCH.slug, coche))).text();
      expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);
      expect(html).not.toMatch(/<link rel="canonical"/);
    }
  });
});
