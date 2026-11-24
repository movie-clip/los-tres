import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED, DEMO_SHOP_HOSTS } from '../fixtures/demo';
import { CAR, UNKNOWN_SLUG, carName, cocheValues, queryOf, selectedText } from '../support/car';

// US-5.7 T5.7.5 (L3t), ACs 43 to 48: while a car is selected every internal link on a public page
// and both GET forms (search, sort) carry `coche=<slug>` once, last on a link; with no car, or an
// unrecognised one, nothing carries it. The one exception is /go/<offer>. The crawl reads the
// rendered anchors, so a new link that forgets withCar fails here whichever page it is on.

const PRODUCT = `/producto/${DEMO_SHARED.slug}`;
const ROOT = '/categoria/mantenimiento-del-coche';

/** The car control's own actions: select and change open the picker, remove drops the car. */
const CONTROL_ACTIONS = new Set(['car-select', 'car-change', 'car-remove']);

type Anchor = { href: string; testid: string | null };

const join = (path: string, query: string): string => `${path}${path.includes('?') ? '&' : '?'}${query}`;

const isInternal = (href: string): boolean => href.startsWith('/') && !href.startsWith('//');

async function anchorsOf(page: Page): Promise<Anchor[]> {
  return page.locator('a[href]').evaluateAll((nodes) =>
    nodes.map((node) => ({ href: node.getAttribute('href') ?? '', testid: node.getAttribute('data-testid') })),
  );
}

/** Every hidden input of every form: its form's testid, name and value. */
async function hiddenOf(page: Page): Promise<{ form: string | null; name: string; value: string }[]> {
  return page.locator('form').evaluateAll((forms) =>
    forms.flatMap((form) =>
      [...form.querySelectorAll('input[type="hidden"]')].map((input) => ({
        form: form.getAttribute('data-testid'),
        name: input.getAttribute('name') ?? '',
        value: (input as HTMLInputElement).value,
      })),
    ),
  );
}

/** Every public page type the crawl covers, as [name, path]. The brand and page 2 are derived below. */
const PAGES: [string, string][] = [
  ['home', '/'],
  ['category', ROOT],
  ['category with a brand', `${ROOT}?marca=bosch`],
  ['empty category', '/categoria/filtros-de-combustible'],
  ['product', PRODUCT],
  ['search results', '/buscar?q=filtro'],
  ['search with no results', '/buscar?q=zzzzqq'],
  ['search page', '/buscar'],
  ['como nos financiamos', '/como-nos-financiamos'],
  ['404', '/esta-pagina-no-existe'],
  ['nested 404, product', '/producto/no-existe-este-producto'],
  ['nested 404, category', '/categoria/no-existe-esta-categoria'],
];

test.describe('with a car: every internal link carries coche once, last (ACs 43, 47)', () => {
  for (const [name, path] of PAGES) {
    test(`${name}: every internal anchor but /go and the control actions ends in coche=<slug>`, async ({ page }) => {
      await page.goto(join(path, `coche=${CAR.slug}`));
      await expect(page.getByTestId('car-label')).toBeVisible();
      const anchors = (await anchorsOf(page)).filter((anchor) => isInternal(anchor.href));
      const carried = anchors.filter(
        (anchor) => !anchor.href.startsWith('/go/') && !CONTROL_ACTIONS.has(anchor.testid ?? ''),
      );
      // Not vacuous: the logo and the three footer links are on every page.
      expect(carried.length, name).toBeGreaterThanOrEqual(4);
      for (const anchor of carried) {
        const query = queryOf(anchor.href);
        expect(cocheValues(anchor.href), `${name}: ${anchor.href}`).toEqual([CAR.slug]);
        expect(query[query.length - 1], `${name}: ${anchor.href}`).toEqual(['coche', CAR.slug]);
      }
      // The logo is one of them: the clicked site name keeps the car (AC 43, R1).
      expect(anchors.find((anchor) => anchor.testid === 'site-header-link')?.href).toBe(`/?coche=${CAR.slug}`);
    });
  }

  test('the remove action carries no coche, so removing the car drops it from the address', async ({ page }) => {
    await page.goto(join(ROOT, `coche=${CAR.slug}`));
    const remove = (await anchorsOf(page)).find((anchor) => anchor.testid === 'car-remove');
    expect(remove?.href).toBeDefined();
    expect(cocheValues(remove!.href)).toEqual([]);
  });

  test('home: the tiles and the all-categories link carry the car', async ({ page }) => {
    await page.goto(join('/', `coche=${CAR.slug}`));
    for (const id of ['category-tile-link', 'home-all-link']) {
      const links = page.getByTestId(id);
      expect(await links.count(), id).toBeGreaterThan(0);
      for (const href of await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))) {
        expect(cocheValues(href), href).toEqual([CAR.slug]);
      }
    }
  });

  test('category: brand chips, cards and pagination carry the car', async ({ page }) => {
    await page.goto(join(ROOT, `coche=${CAR.slug}`));
    for (const id of ['card-title', 'pagination-next']) {
      const links = page.getByTestId(id);
      expect(await links.count(), id).toBeGreaterThan(0);
      for (const href of await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))) {
        expect(cocheValues(href), `${id}: ${href}`).toEqual([CAR.slug]);
      }
    }
    expect(await page.getByTestId('brand-chip').count()).toBeGreaterThan(0);
    for (const href of await page
      .getByTestId('brand-chip')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))) {
      expect(cocheValues(href), href).toEqual([CAR.slug]);
    }
  });

  test('category with a brand: "all brands" keeps the car and drops the brand', async ({ page }) => {
    await page.goto(join(`${ROOT}?marca=bosch`, `coche=${CAR.slug}`));
    const all = page.getByTestId('brand-chip-all').first();
    const href = (await all.getAttribute('href')) ?? '';
    expect(href).toBe(`${ROOT}?coche=${CAR.slug}`);
  });

  test('category page 2: previous and next carry the car, and the page parameter comes first', async ({ page }) => {
    await page.goto(join(ROOT, `coche=${CAR.slug}`));
    const next = (await page.getByTestId('pagination-next').getAttribute('href')) ?? '';
    const [, ...afterPath] = next.split('?');
    expect(afterPath.join('?')).toMatch(/^pagina=2&coche=/);
    await page.goto(next);
    const prev = (await page.getByTestId('pagination-prev').getAttribute('href')) ?? '';
    expect(cocheValues(prev)).toEqual([CAR.slug]);
    expect(queryOf(prev).at(-1)).toEqual(['coche', CAR.slug]);
  });

  test('product: the breadcrumb carries the car and the shop links do not (AC 48)', async ({ page }) => {
    await page.goto(join(PRODUCT, `coche=${CAR.slug}`));
    const crumbs = await page
      .getByTestId('breadcrumb')
      .locator('a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(crumbs.length).toBeGreaterThan(0);
    for (const href of crumbs) expect(cocheValues(href), href).toEqual([CAR.slug]);
    const offers = await page
      .getByTestId('offer-go')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(offers).toHaveLength(DEMO_SHARED.offers.length);
    for (const href of offers) {
      expect(href).toMatch(/^\/go\/\d+$/);
      expect(href).not.toContain('coche');
    }
  });

  test('the /go link answers a redirect whose Location has no coche (AC 48)', async ({ page, request }) => {
    await page.goto(join(PRODUCT, `coche=${CAR.slug}`));
    const href = (await page.getByTestId('offer-go').first().getAttribute('href')) ?? '';
    const response = await request.get(href, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).not.toContain('coche');
  });

  test('no page names the car in a canonical link, and no anchor carries it twice', async ({ page }) => {
    for (const [name, path] of PAGES) {
      await page.goto(join(path, `coche=${CAR.slug}`));
      const canonical = await page.locator('link[rel="canonical"]').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('href') ?? ''),
      );
      for (const href of canonical) expect(href, name).not.toContain('coche');
      for (const anchor of await anchorsOf(page)) {
        expect(cocheValues(anchor.href).length, `${name}: ${anchor.href}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

test.describe('with a car: both GET forms keep it (ACs 44, 45, 47)', () => {
  test('every search form on every page has exactly one hidden coche with the slug', async ({ page }) => {
    for (const [name, path] of PAGES) {
      await page.goto(join(path, `coche=${CAR.slug}`));
      const searchForms = await page.locator('form[role="search"]').evaluateAll((forms) =>
        forms.map((form) => form.getAttribute('data-testid') ?? ''),
      );
      expect(searchForms.length, name).toBeGreaterThan(0);
      const hidden = await hiddenOf(page);
      for (const form of searchForms) {
        const own = hidden.filter((field) => field.form === form && field.name === 'coche');
        expect(own, `${name}: ${form}`).toEqual([{ form, name: 'coche', value: CAR.slug }]);
      }
    }
  });

  for (const [name, path, inputId, buttonId] of [
    ['home hero', '/', 'home-search-input', 'home-search-button'],
    ['header on a category', ROOT, 'header-search-input', 'header-search-button'],
    ['page on /buscar', '/buscar?q=filtro', 'search-input', 'search-button'],
  ] as const) {
    test(`AC 44: submitting the ${name} search lands on /buscar with the term and the car, once`, async ({ page }) => {
      await page.goto(join(path, `coche=${CAR.slug}`));
      const input = page.getByTestId(inputId);
      await input.fill('aceite');
      await page.getByTestId(buttonId).click();
      await page.waitForURL((url) => url.pathname === '/buscar' && url.searchParams.get('q') === 'aceite');
      expect(cocheValues(page.url())).toEqual([CAR.slug]);
      expect(queryOf(page.url()).filter(([key]) => key === 'q')).toEqual([['q', 'aceite']]);
      await expect(page.getByTestId('car-label')).toBeVisible();
    });
  }

  test('AC 45: submitting the sort keeps the car and the chosen brand, once, and lands on page 1', async ({ page }) => {
    await page.goto(join(`${ROOT}?marca=bosch`, `coche=${CAR.slug}`));
    const select = page.getByTestId('category-sort-select');
    const current = await select.inputValue();
    const options = await select.locator('option').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value),
    );
    const other = options.find((value) => value !== current);
    expect(other).toBeDefined();
    await select.selectOption(other!);
    await page.getByTestId('category-sort-submit').click();
    await page.waitForURL((url) => url.searchParams.get('orden') === other);
    const query = queryOf(page.url());
    expect(new URL(page.url()).pathname).toBe(ROOT);
    expect(query).toContainEqual(['orden', other!]);
    expect(query).toContainEqual(['marca', 'bosch']);
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    expect(query.at(-1)).toEqual(['coche', CAR.slug]);
    expect(query.map(([key]) => key)).not.toContain('pagina');
  });

  test('AC 45: the sort with no brand chosen keeps the car and adds no marca', async ({ page }) => {
    await page.goto(join(ROOT, `coche=${CAR.slug}`));
    const select = page.getByTestId('category-sort-select');
    const current = await select.inputValue();
    const options = await select.locator('option').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value),
    );
    const other = options.find((value) => value !== current)!;
    await select.selectOption(other);
    await page.getByTestId('category-sort-submit').click();
    await page.waitForURL((url) => url.searchParams.get('orden') === other);
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    expect(queryOf(page.url()).map(([key]) => key)).not.toContain('marca');
  });
});

const NO_CAR: [string, string][] = [
  ['no car', ''],
  ['an unrecognised car', `coche=${UNKNOWN_SLUG}`],
  ['a malformed car', 'coche=Mal%20Formado%21'],
  ['an empty car', 'coche='],
];

for (const [kind, query] of NO_CAR) {
  test.describe(`with ${kind}: nothing carries coche (AC 46)`, () => {
    for (const [name, path] of PAGES) {
      test(`${name}: no anchor, form or canonical names coche`, async ({ page }) => {
        await page.goto(query === '' ? path : join(path, query));
        await expect(page.getByTestId('car-select')).toBeVisible();
        const anchors = await anchorsOf(page);
        expect(anchors.length, name).toBeGreaterThan(0);
        for (const anchor of anchors) {
          expect(cocheValues(anchor.href), `${name}: ${anchor.href}`).toEqual([]);
          // The picker links return to the page by `volver`: its value must not hold coche either.
          const volver = new URL(anchor.href, 'http://h.invalid').searchParams.get('volver');
          if (volver !== null) expect(cocheValues(volver), `${name}: ${anchor.href}`).toEqual([]);
        }
        expect((await hiddenOf(page)).filter((field) => field.name === 'coche')).toEqual([]);
        const canonical = await page.locator('link[rel="canonical"]').evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('href') ?? ''),
        );
        for (const href of canonical) expect(href, name).not.toContain('coche');
      });
    }

    test('a submitted search adds no coche, not even an empty one', async ({ page }) => {
      await page.goto(query === '' ? '/' : join('/', query));
      await page.getByTestId('home-search-input').fill('aceite');
      await page.getByTestId('home-search-button').click();
      await page.waitForURL((url) => url.pathname === '/buscar');
      expect(new URL(page.url()).searchParams.has('coche')).toBe(false);
      expect(new URL(page.url()).searchParams.get('q')).toBe('aceite');
    });

    test('a submitted sort adds no coche, not even an empty one', async ({ page }) => {
      await page.goto(query === '' ? `${ROOT}?marca=bosch` : join(`${ROOT}?marca=bosch`, query));
      const select = page.getByTestId('category-sort-select');
      const current = await select.inputValue();
      const options = await select.locator('option').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLOptionElement).value),
      );
      const other = options.find((value) => value !== current)!;
      await select.selectOption(other);
      await page.getByTestId('category-sort-submit').click();
      await page.waitForURL((url) => url.searchParams.get('orden') === other);
      expect(new URL(page.url()).searchParams.has('coche')).toBe(false);
      expect(queryOf(page.url())).toContainEqual(['marca', 'bosch']);
    });
  });
}

test.describe('a car on the page survives a click on the logo as a full load (D8)', () => {
  test('the logo goes to / with the car and the header names it', async ({ page }) => {
    await page.goto(join(ROOT, `coche=${CAR.slug}`));
    await page.evaluate(() => {
      (window as unknown as { __marker: boolean }).__marker = true;
    });
    await page.getByTestId('site-header-link').click();
    await page.waitForURL((url) => url.pathname === '/');
    expect(cocheValues(page.url())).toEqual([CAR.slug]);
    // A plain anchor is a document load: the marker set on the old document is gone.
    expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker)).toBeUndefined();
    await expect(page.getByTestId('car-label')).toBeVisible();
  });
});

// #339 (0006 rule 12): journey J7, with a car selected: from the listing to a product with its fit banner, `coche`
// kept on the links of each page, and none of it through the click-out. Added beside the tests it replaces.
test.describe('with a car: listing, product, click-out journey (#339)', () => {
  /**
   * Every internal anchor outside the car control and the vehicle list: it ends in `coche=<slug>`, once, and is not
   * a /go link. The list's tiles are the one link whose car is not the selected one, so they are not in this sweep.
   */
  async function expectCarried(page: Page, name: string): Promise<void> {
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll(
        (nodes, label) =>
          nodes
            .filter(
              (node) =>
                node.closest(`[role="group"][aria-label="${label}"]`) === null &&
                node.closest('[data-testid="vehicle-list"]') === null,
            )
            .map((node) => node.getAttribute('href') ?? ''),
        messages.Car.groupLabel,
      );
    const carried = hrefs.filter((href) => isInternal(href) && !href.startsWith('/go/'));
    // Not vacuous: the logo and the three footer links are on every page.
    expect(carried.length, name).toBeGreaterThanOrEqual(4);
    for (const href of carried) {
      expect(cocheValues(href), `${name}: ${href}`).toEqual([CAR.slug]);
      expect(queryOf(href).at(-1), `${name}: ${href}`).toEqual(['coche', CAR.slug]);
    }
  }

  test('J7: the car stays on every link from the home page to a product, and the click-out to the shop carries none', async ({
    page,
    context,
    baseURL,
  }) => {
    const goRequests: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.startsWith('/go/')) goRequests.push(req.url());
    });

    await page.goto(join('/', `coche=${CAR.slug}`));
    await expect(page.getByRole('group', { name: messages.Car.groupLabel })).toContainText(selectedText(CAR));
    await expectCarried(page, 'home');

    // The listing, then a compatible product from its first group.
    await page.goto(join(ROOT, `coche=${CAR.slug}`));
    await expectCarried(page, 'category');
    const fits = page.getByRole('region', { name: messages.Fit.fitsHeading.replace('{car}', carName(CAR)) });
    await expect(fits).toBeVisible();
    await fits.getByRole('heading', { level: 3 }).first().getByRole('link').click();
    await expect(page).toHaveURL(/\/producto\//);
    expect(cocheValues(page.url())).toEqual([CAR.slug]);

    // The product page says, in words, that it fits the car, and its links carry the car.
    await expect(
      page.getByRole('note').filter({ hasText: messages.ProductFit.bannerFits.replace('{car}', carName(CAR)) }),
    ).toHaveCount(1);
    await expectCarried(page, 'product');
    // The vehicle list's tiles are links to the category for their own car: the category path, `coche` once, and nothing else.
    const tiles = await page
      .getByTestId('vehicle-list')
      .getByRole('link')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(tiles.length).toBeGreaterThan(0);
    for (const href of tiles) expect(href).toMatch(/^\/categoria\/[a-z0-9-]+\?coche=[a-z0-9-]+$/);
    expect(tiles).toContainEqual(expect.stringContaining(`coche=${CAR.slug}`));

    // The shop links are /go paths without the car, and so is the redirect they answer.
    const shopLinks = page.getByRole('link', { name: /^Ir a la tienda de / });
    const hrefs = await shopLinks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/go\/\d+$/);
      expect(href).not.toContain('coche');
    }
    const redirect = await page.request.get(hrefs[0], { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers()['location']).not.toContain('coche');

    // The click: the one /go request has no car, and the shop's request carries none in its Referer (at most our origin).
    const shopRequest = page.waitForRequest((req) => DEMO_SHOP_HOSTS.some((host) => new URL(req.url()).hostname === host));
    await shopLinks.first().click();
    const shop = await shopRequest;
    expect(goRequests).toHaveLength(1);
    expect(goRequests[0]).not.toContain('coche');
    const referer = await shop.headerValue('referer');
    expect(referer ?? '').not.toContain('coche');
    if (referer !== null) {
      const url = new URL(referer);
      expect(url.origin).toBe(new URL(baseURL ?? '').origin);
      expect(url.pathname + url.search).toBe('/');
    }
    expect(await context.cookies()).toEqual([]);
  });
});
