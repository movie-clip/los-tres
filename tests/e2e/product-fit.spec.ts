import { expect, test, type Browser, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_BOSCH, DEMO_ILLUSTRATED, DEMO_SHARED } from '../fixtures/demo';
import {
  CAR,
  CAR_STORAGE_KEY,
  UNKNOWN_SLUG,
  carName,
  cocheValues,
  queryOf,
  seedStorage,
  storageOf,
} from '../support/car';
import { VEHICLE_CATALOGUE } from '../../src/db/vehicle-catalogue';
import { normaliseSpaces } from '../support/messages';
import { expectNoSetCookie, openRawHtml } from '../support/page-checks';

// US-5.9 T5.9.1 (#279): the fit banner on the product page, against the Compose stack. The three
// states come from the demo products with CAR (Seat León III 1.6 TDI): bosch fits it, the Mahle
// oil filter has a Toyota Corolla fitment only (no-fit) and OC 1234 has no fitment (unknown). The
// could-not-check state and the unavailable car need a failing read the demo cannot produce: they
// are proven in tests/integration/product-fit.test.ts. Reflow is in reflow.spec.ts.

const BOSCH = DEMO_ILLUSTRATED['filtros-de-aceite'];
const MAHLE_OIL = 'demo-filtro-de-aceite-mahle-of-1124';
const CATEGORY = '/categoria/filtros-de-aceite';

const urlOf = (slug: string, coche?: string): string =>
  `/producto/${slug}${coche === undefined ? '' : `?coche=${coche}`}`;

const CAR_NAME = carName(CAR);

type State = {
  name: string;
  slug: string;
  kind: 'fits' | 'no-fit' | 'unknown';
  text: string;
  help: string | null;
  link: boolean;
  /** How many vehicle-list tiles the demo product shows (S5.9 #280): bosch 12 after D-2, Mahle 1, OC 1234 none. */
  tiles: number;
};

const STATES: State[] = [
  {
    name: 'fits',
    slug: BOSCH,
    kind: 'fits',
    text: messages.ProductFit.bannerFits.replace('{car}', CAR_NAME),
    help: null,
    link: false,
    tiles: DEMO_BOSCH.vehicles.length,
  },
  {
    name: 'no-fit',
    slug: MAHLE_OIL,
    kind: 'no-fit',
    text: messages.ProductFit.bannerNoFit.replace('{car}', CAR_NAME),
    help: null,
    link: true,
    tiles: 1,
  },
  {
    name: 'unknown',
    slug: DEMO_SHARED.slug,
    kind: 'unknown',
    text: messages.ProductFit.bannerUnknown,
    help: messages.Fit.unknownHelp,
    link: false,
    tiles: 0,
  },
];

const banner = (page: Page) => page.getByTestId('fit-banner');
const norm = (value: string | null): string => normaliseSpaces((value ?? '').trim());

/** Every word the three other banner kinds say, so one banner never says two things. */
const OTHER_KINDS = [
  messages.ProductFit.bannerUnchecked,
  messages.ProductFit.bannerUnknown,
  messages.ProductFit.bannerFits.replace('{car}', CAR_NAME),
  messages.ProductFit.bannerNoFit.replace('{car}', CAR_NAME),
];

/** A JavaScript-off page, so the state is the server's alone (AC 28). */
async function withoutScript<T>(browser: Browser, baseURL: string | undefined, run: (page: Page) => Promise<T>) {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

const offersOf = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="offer-go"]')].map((node) => {
      const row = node.closest('li') ?? node.parentElement;
      return {
        href: node.getAttribute('href'),
        label: node.getAttribute('aria-label'),
        row: (row?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      };
    }),
  );

const jsonLdOf = (html: string): unknown[] =>
  [...html.matchAll(/<script[^>]* type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) =>
    JSON.parse(match[1]),
  );

for (const mode of ['with JavaScript', 'with JavaScript off'] as const) {
  test.describe(`the banner with a selected car, ${mode} (ACs 1 to 4, 28, 30)`, () => {
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

    for (const state of STATES) {
      test(`${state.name}: exactly one banner, in words, before the offers`, async ({ page, browser, baseURL }) => {
        await open(page, browser, baseURL, urlOf(state.slug, CAR.slug), async (shown) => {
          await expect(banner(shown)).toHaveCount(1);
          const one = banner(shown);
          await expect(one).toHaveAttribute('data-fit', state.kind);
          await expect(one).toHaveAttribute('role', 'note');
          // The words carry the meaning: the lead text is the message, and the help line only for unknown.
          const lead = norm(await one.locator('span').filter({ hasText: state.text }).first().textContent());
          expect(lead).toBe(norm(state.text));
          if (state.help === null) {
            await expect(one.locator('p')).toHaveCount(0);
          } else {
            await expect(one.locator('p')).toHaveText(state.help);
          }
          // It never says another kind's words (AC 4: unknown never says fits or does not fit).
          const all = norm(await one.textContent());
          for (const other of OTHER_KINDS.filter((words) => words !== state.text)) {
            expect(all, other).not.toContain(other);
          }
          if (state.kind === 'unknown') {
            expect(all.toLowerCase()).not.toMatch(/no es compatible|compatible con tu/);
          }
          // Before the offers in reading order (AC 1), after the product's heading.
          const order = await shown.evaluate(() => {
            const note = document.querySelector('[data-testid="fit-banner"]')!;
            const heading = document.querySelector('h1')!;
            const offers = document.querySelector('[data-testid="offer-go"]')!;
            const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
            return { afterTitle: before(heading, note), beforeOffers: before(note, offers) };
          });
          expect(order).toEqual({ afterTitle: true, beforeOffers: true });
        });
      });

      test(`${state.name}: the no-fit link is the category with coche and nothing else, and only no-fit has one`, async ({
        page,
        browser,
        baseURL,
      }) => {
        await open(page, browser, baseURL, urlOf(state.slug, CAR.slug), async (shown) => {
          const link = shown.getByTestId('fit-banner-link');
          if (!state.link) {
            await expect(link).toHaveCount(0);
            await expect(banner(shown).locator('a')).toHaveCount(0);
            return;
          }
          await expect(link).toHaveCount(1);
          await expect(link).toHaveText(messages.ProductFit.bannerNoFitLink);
          // The exact target (AC 3, 22): the product's own category, coche, no other parameter.
          expect(await link.getAttribute('href')).toBe(`${CATEGORY}?coche=${CAR.slug}`);
          expect(await link.getAttribute('rel')).toBeNull();
          expect(await link.getAttribute('target')).toBeNull();
        });
      });
    }

    test('the no-fit link leads to the category listing for the car (AC 3)', async ({ page, browser, baseURL }) => {
      await open(page, browser, baseURL, urlOf(MAHLE_OIL, CAR.slug), async (shown) => {
        await shown.getByTestId('fit-banner-link').click();
        await shown.waitForURL((url) => url.pathname === CATEGORY);
        expect(queryOf(shown.url())).toEqual([['coche', CAR.slug]]);
        await expect(shown.getByRole('heading', { level: 1 })).toBeVisible();
      });
    });
  });
}

/** The vertical centre of the label's first rendered line, and of the link, in page pixels (#293). */
const noFitGeometry = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid="fit-banner"]')!;
    const link = root.querySelector('[data-testid="fit-banner-link"]')!.getBoundingClientRect();
    const labelNode = root.querySelector('span:not([aria-hidden])')!;
    const lead = labelNode.closest('div')!.parentElement!;
    const range = document.createRange();
    range.selectNodeContents(labelNode);
    const first = range.getClientRects()[0];
    const label = labelNode.getBoundingClientRect();
    return {
      linkCentre: link.top + link.height / 2,
      linkTop: link.top,
      linkLeft: link.left,
      firstLineCentre: first.top + first.height / 2,
      labelBottom: label.bottom,
      labelLeft: label.left,
      leadPaddingTop: getComputedStyle(lead).paddingTop,
    };
  });

test.describe('the no-fit link lines up with the lead (#293)', () => {
  test('at 1280 the link centre is within 2px of the first line of the lead, and the link sits beside the lead', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(urlOf(MAHLE_OIL, CAR.slug));
    await expect(page.getByTestId('fit-banner-link')).toBeVisible();
    const g = await noFitGeometry(page);
    expect(Math.abs(g.linkCentre - g.firstLineCentre)).toBeLessThanOrEqual(2);
    // Beside, not under: the link starts to the right of the label.
    expect(g.linkLeft).toBeGreaterThan(g.labelLeft);
  });

  test('at 390 the link wraps under the lead, which keeps no extra top padding', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(urlOf(MAHLE_OIL, CAR.slug));
    await expect(page.getByTestId('fit-banner-link')).toBeVisible();
    const g = await noFitGeometry(page);
    expect(g.linkTop).toBeGreaterThanOrEqual(g.labelBottom - 0.5);
    expect(g.linkCentre).toBeGreaterThan(g.firstLineCentre);
    expect(g.leadPaddingTop).toBe('0px');
  });
});

test.describe('no banner without a selected car (ACs 7, 8, 11)', () => {
  test('a product page with no coche shows no banner, with JavaScript off too', async ({ page, browser, baseURL }) => {
    for (const state of STATES) {
      await page.goto(urlOf(state.slug));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
    }
    await withoutScript(browser, baseURL, async (plain) => {
      for (const state of STATES) {
        await plain.goto(urlOf(state.slug));
        await expect(banner(plain)).toHaveCount(0);
        const body = norm(await plain.locator('main').textContent());
        for (const words of [messages.ProductFit.bannerUnknown, messages.ProductFit.bannerUnchecked]) {
          expect(body).not.toContain(words);
        }
      }
    });
  });

  for (const [name, value] of [
    ['an unrecognised', UNKNOWN_SLUG],
    ['a malformed', 'NO%20ES%20UN%20SLUG'],
    ['an empty', ''],
  ] as const) {
    test(`${name} coche shows no banner and no could-not-check line; the notice stays`, async ({ page, browser, baseURL }) => {
      for (const state of STATES) {
        await page.goto(urlOf(state.slug, value));
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(banner(page)).toHaveCount(0);
        await expect(page.getByText(messages.ProductFit.bannerUnchecked)).toHaveCount(0);
        // The product's offers are all still there.
        expect((await offersOf(page)).length).toBeGreaterThan(0);
      }
      await withoutScript(browser, baseURL, async (plain) => {
        await plain.goto(urlOf(BOSCH, value));
        await expect(banner(plain)).toHaveCount(0);
        if (value !== '') {
          await expect(plain.getByText(messages.Car.unknownNotice)).toHaveCount(1);
        }
      });
    });
  }

  test('a stored car with no coche in the URL shows no banner on the first server HTML, then the banner once the script adds coche (AC 11)', async ({
    page,
    browser,
    baseURL,
    request,
  }) => {
    // The server's answer to the bare URL has no banner, whatever the browser stores.
    const bare = await (await request.get(urlOf(BOSCH))).text();
    expect(bare).not.toContain('data-testid="fit-banner"');

    const context = await browser.newContext({ baseURL });
    const scripted = await context.newPage();
    await seedStorage(scripted, CAR.slug);
    await scripted.goto(urlOf(BOSCH));
    await scripted.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
    await expect(banner(scripted)).toHaveCount(1);
    await expect(banner(scripted)).toHaveAttribute('data-fit', 'fits');
    // Showing the banner is not a write: the stored value is unchanged, and no cookie exists (AC 27).
    expect(await storageOf(scripted)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });
    expect(await context.cookies()).toEqual([]);
    await context.close();

    // The page itself reads the URL only: a plain visit without storage seeds nothing.
    await page.goto(urlOf(BOSCH));
    await expect(banner(page)).toHaveCount(0);
    expect(await storageOf(page)).toEqual({});
  });
});

test.describe('the page is only marked, never changed (AC 6, 26)', () => {
  for (const state of STATES) {
    test(`${state.name}: same status, title, offers, prices and shop links as without a car`, async ({ page, request }) => {
      const without = await request.get(urlOf(state.slug));
      const withCar = await request.get(urlOf(state.slug, CAR.slug));
      expect(withCar.status()).toBe(without.status());
      expect(withCar.status()).toBe(200);

      await page.goto(urlOf(state.slug));
      const plain = {
        title: await page.getByRole('heading', { level: 1 }).textContent(),
        price: await page.getByTestId('product-price').allTextContents(),
        offers: await offersOf(page),
        description: await page.getByTestId('product-description').allTextContents(),
      };
      await page.goto(urlOf(state.slug, CAR.slug));
      const marked = {
        title: await page.getByRole('heading', { level: 1 }).textContent(),
        price: await page.getByTestId('product-price').allTextContents(),
        offers: await offersOf(page),
        description: await page.getByTestId('product-description').allTextContents(),
      };
      expect(plain.offers.length).toBeGreaterThan(0);
      expect(marked).toEqual(plain);
    });
  }

  test('a product that does not exist answers 404 with a car and shows no banner (AC 26)', async ({ page, request }) => {
    const response = await request.get(urlOf('no-existe-este-producto', CAR.slug));
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('data-testid="fit-banner"');
    await page.goto(urlOf('no-existe-este-producto', CAR.slug));
    await expect(banner(page)).toHaveCount(0);
  });
});

test.describe('links (ACs 22, 23)', () => {
  type Anchor = { href: string; testid: string | null };
  const anchorsOf = (page: Page): Promise<Anchor[]> =>
    page.locator('a[href]').evaluateAll((nodes) =>
      nodes.map((node) => ({ href: node.getAttribute('href') ?? '', testid: node.getAttribute('data-testid') })),
    );
  const CONTROL_ACTIONS = new Set(['car-select', 'car-change', 'car-remove']);
  // S5.9 #280 AC 18: a vehicle-list tile is the one link whose coche is its own vehicle, not the selected car.
  // The sweeps below take the tiles out and assert them on their own, so every other link is still held to the rule.
  const TILE = 'vehicle-list-row';
  const isTile = (anchor: Anchor) => anchor.testid === TILE;
  /** The tile rule: the product's category, the tile's own vehicle in coche, once, as the only parameter. */
  const expectOwnVehicle = (anchor: Anchor, where: string) => {
    const own = cocheValues(anchor.href);
    expect(own, `${where}: ${anchor.href}`).toHaveLength(1);
    expect(anchor.href, where).toBe(`${CATEGORY}?coche=${own[0]}`);
    expect(VEHICLE_CATALOGUE.some((vehicle) => vehicle.slug === own[0]), `${where}: ${own[0]} is a vehicle`).toBe(true);
  };

  for (const state of STATES) {
    test(`${state.name}: every internal link but /go and the car control carries coche once and last; /go carries nothing`, async ({
      page,
    }) => {
      await page.goto(urlOf(state.slug, CAR.slug));
      await expect(banner(page)).toHaveCount(1);
      const anchors = (await anchorsOf(page)).filter((anchor) => anchor.href.startsWith('/') && !anchor.href.startsWith('//'));
      const tiles = anchors.filter(isTile);
      const carried = anchors.filter((anchor) => !anchor.href.startsWith('/go/') && !CONTROL_ACTIONS.has(anchor.testid ?? '') && !isTile(anchor));
      expect(carried.length).toBeGreaterThanOrEqual(4);
      for (const anchor of carried) {
        expect(cocheValues(anchor.href), anchor.href).toEqual([CAR.slug]);
        expect(queryOf(anchor.href).at(-1), anchor.href).toEqual(['coche', CAR.slug]);
      }
      // Tiles: bosch lists its twelve, the Mahle oil filter its one, OC 1234 none; each carries its own vehicle (AC 18).
      expect(tiles.length, state.name).toBe(state.tiles);
      for (const tile of tiles) expectOwnVehicle(tile, state.name);
      const go = anchors.filter((anchor) => anchor.href.startsWith('/go/'));
      expect(go.length).toBeGreaterThan(0);
      for (const anchor of go) {
        expect(anchor.href).toMatch(/^\/go\/\d+$/);
        expect(anchor.href).not.toContain('?');
      }
    });
  }

  test('with no car and with an unrecognised one no link carries coche (AC 22)', async ({ page }) => {
    for (const url of [urlOf(MAHLE_OIL), urlOf(MAHLE_OIL, UNKNOWN_SLUG), urlOf(BOSCH), urlOf(BOSCH, UNKNOWN_SLUG)]) {
      await page.goto(url);
      const anchors = await anchorsOf(page);
      // The list tiles are the only exception (AC 18, AC 22): their own vehicle, whether or not a car is selected.
      for (const anchor of anchors.filter((item) => !isTile(item))) {
        expect(cocheValues(anchor.href), `${url}: ${anchor.href}`).toEqual([]);
      }
      const tiles = anchors.filter(isTile);
      expect(tiles.length, url).toBeGreaterThan(0);
      for (const tile of tiles) expectOwnVehicle(tile, url);
    }
  });

  test('a /go redirect holds no coche and following the no-fit link does not write the stored car (AC 23)', async ({
    page,
    request,
  }) => {
    await page.goto(urlOf(MAHLE_OIL, CAR.slug));
    const href = (await page.getByTestId('offer-go').first().getAttribute('href')) ?? '';
    const response = await request.get(href, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).not.toContain('coche');
    await page.getByTestId('fit-banner-link').click();
    await page.waitForURL((url) => url.pathname === CATEGORY);
    expect(await storageOf(page)).toEqual({});
  });
});

test.describe('what stays the same under a car (ACs 24, 25, 27)', () => {
  const robotsOf = (page: Page) =>
    page.locator('meta[name="robots"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''));
  const canonicalsOf = (page: Page) =>
    page.locator('link[rel="canonical"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));

  for (const state of STATES) {
    test(`${state.name}: the JSON-LD is identical with and without a car and says nothing about fit`, async ({ request }) => {
      const without = await request.get(urlOf(state.slug));
      const withCar = await request.get(urlOf(state.slug, CAR.slug));
      expectNoSetCookie(without);
      expectNoSetCookie(withCar);
      const before = jsonLdOf(await without.text());
      const after = jsonLdOf(await withCar.text());
      expect(before).toHaveLength(1);
      expect(after).toEqual(before);
      const text = JSON.stringify(after).toLowerCase();
      for (const word of [CAR.slug, CAR_NAME, 'compatible', 'vehicle', 'fitment', 'coche']) {
        expect(text, word).not.toContain(word.toLowerCase());
      }
    });

    test(`${state.name}: with a car it is noindex with no canonical, and the title is unchanged`, async ({ request, browser }) => {
      const withCar = await openRawHtml(browser, await (await request.get(urlOf(state.slug, CAR.slug))).text());
      const bare = await openRawHtml(browser, await (await request.get(urlOf(state.slug))).text());
      try {
        expect((await robotsOf(withCar.page)).some((content) => /noindex/.test(content))).toBe(true);
        expect(await canonicalsOf(withCar.page)).toEqual([]);
        expect(await withCar.page.title()).toBe(await bare.page.title());
        // The page without a car keeps the answer it has today: a demo product is noindex, no canonical.
        expect((await robotsOf(bare.page)).some((content) => /noindex/.test(content))).toBe(true);
        expect(await canonicalsOf(bare.page)).toEqual([]);
      } finally {
        await withCar.close();
        await bare.close();
      }
    });
  }

  test('an unrecognised car is noindex too, with no canonical', async ({ request, browser }) => {
    const { page, close } = await openRawHtml(browser, await (await request.get(urlOf(BOSCH, UNKNOWN_SLUG))).text());
    expect((await robotsOf(page)).some((content) => /noindex/.test(content))).toBe(true);
    expect(await canonicalsOf(page)).toEqual([]);
    await close();
  });

  test('the sitemap lists no coche and no demo product, with or without a car on the product page', async ({ request }) => {
    const index = await (await request.get('/sitemap.xml')).text();
    const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    for (const loc of locs) {
      const body = await (await request.get(new URL(loc).pathname)).text();
      expect(body).not.toContain('coche');
      expect(body).not.toContain(BOSCH);
    }
  });

  test('a visit with a car sets no cookie and stays on the app origin, with no storage written (AC 27)', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    for (const state of STATES) {
      await page.goto(urlOf(state.slug, CAR.slug));
      await expect(banner(page)).toHaveCount(1);
    }
    expect(await context.cookies()).toEqual([]);
    expect(await storageOf(page)).toEqual({});
    const origin = new URL(baseURL ?? '').origin;
    for (const url of requested) expect(new URL(url).origin, url).toBe(origin);
    await context.close();
  });
});
