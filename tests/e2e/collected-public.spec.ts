import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_COUNTS } from '../fixtures/demo';
import { CAR } from '../support/car';
import { startIsolatedApp, type IsolatedApp } from '../support/isolated-app';
import { icuPlural, normaliseSpaces } from '../support/messages';
import { expectNoSetCookie, expectServerRenderedNotFound, openRawHtml, stripScripts } from '../support/page-checks';

// S12.2 (decision 0017), ACs 13 to 27 and 36 on the REAL app: marked rows (rows of a collected feed) are on no
// public page with the local flag off, are shown only with the flag on beside a loopback SITE_URL, and are
// never indexed, listed or counted either way. Two app containers of their own, on databases of their own
// (tests/support/isolated-app.ts, one per flag state), each seeded the same way with invented rows written by
// psql: a collected file may never be placed in the owner's folder, so the rows are what an import of one
// would leave (the importer's marking is collected-import.test.ts, the sweep over every reader is
// collected-public-sweep.test.ts). The development database is never touched.
//
//   off  LOCAL_COLLECTED_DATA=false beside a PUBLIC https SITE_URL: the state of a deploy (AC 36: it starts)
//   on   LOCAL_COLLECTED_DATA=true beside the loopback SITE_URL the harness gives: the owner's local stack
//
// The app refuses to start with the flag on beside a public SITE_URL, so that combination (the backstop,
// AC 37) is not a live case: collected-public-sweep.test.ts runs it over the readers, and
// collected-start.spec.ts proves the refusal. Serial: each app is shared by its tests.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const PUBLIC_ORIGIN = 'https://tienda-publica.example';
const siteName = (process.env.SITE_NAME ?? '').trim();

const M = { slug: 'e2e-marcado', title: 'Filtro Colibri E2E reservado', term: 'Colibri', part: 'E2E-77', price: 1234, link: 'https://tienda-recopilada.example/p/m1' };
const U = { slug: 'e2e-escrito', title: 'Filtro Pelicano E2E escrito', term: 'Pelicano', handPrice: 2000, markedPrice: 1000, markedLink: 'https://tienda-recopilada.example/p/u2' };

type World = { cm: string; cu: string; offerM: number; offerUMarked: number; offerUHand: number };

function seed(app: IsolatedApp): World {
  const scalar = (sql: string) => app.psqlScalar(sql);
  // An empty child category for M alone, and a child that already holds demo products for U.
  const cm = scalar(
    'select slug from categories c where c.parent_id is not null and not exists (select 1 from products p where p.category_id = c.id) order by c.position, c.id limit 1',
  );
  const cu = scalar(
    'select slug from categories c where c.parent_id is not null and exists (select 1 from products p where p.category_id = c.id) order by c.position, c.id limit 1',
  );
  expect(cm, 'an empty child category in the demo tree').not.toBe('');
  expect(cu, 'a child category holding demo products').not.toBe('');

  app.psql("insert into shops (slug, name, is_approved) values ('e2e-recopilada', 'Tienda uno e2e', true), ('e2e-escrita', 'Tienda dos e2e', true)");
  app.psql("insert into feeds (shop_id, source_type, url, is_approved, is_demo) select id, 'collected_file', 'recopilado-e2e.csv', true, false from shops where slug = 'e2e-recopilada'");
  app.psql("insert into feeds (shop_id, source_type, url, is_approved, is_demo) select id, 'shop_upload', 'escrito-e2e.csv', true, false from shops where slug = 'e2e-escrita'");
  app.psql(
    `insert into products (slug, title, brand, brand_normalised, part_number, part_number_normalised, category_id, is_collected) select '${M.slug}', '${M.title}', 'MarcaE2E', 'MARCAE2E', '${M.part}', 'E2E77', id, true from categories where slug = '${cm}'`,
  );
  app.psql(`insert into products (slug, title, brand, brand_normalised, category_id) select '${U.slug}', '${U.title}', 'MarcaE2E', 'MARCAE2E', id from categories where slug = '${cu}'`);
  const offer = (product: string, feed: string, external: string, price: number, url: string) =>
    app.psql(
      `insert into offers (product_id, feed_id, external_id, price_cents, url, price_updated_at) select p.id, f.id, '${external}', ${price}, '${url}', now() from products p, feeds f where p.slug = '${product}' and f.url = '${feed}'`,
    );
  offer(M.slug, 'recopilado-e2e.csv', 'm-1', M.price, M.link);
  offer(U.slug, 'escrito-e2e.csv', 'u-1', U.handPrice, 'https://tienda-escrita.example/p/u1');
  offer(U.slug, 'recopilado-e2e.csv', 'u-2', U.markedPrice, U.markedLink);

  const id = (product: string, external: string) =>
    Number(scalar(`select o.id from offers o join products p on p.id = o.product_id where p.slug = '${product}' and o.external_id = '${external}'`));
  return { cm, cu, offerM: id(M.slug, 'm-1'), offerUMarked: id(U.slug, 'u-2'), offerUHand: id(U.slug, 'u-1') };
}

const clicks = (app: IsolatedApp): number => Number(app.psqlScalar('select count(*) from clicks'));

async function get(request: APIRequestContext, path: string, options: { redirects?: boolean } = {}): Promise<APIResponse> {
  const response = await request.get(path, { maxRedirects: options.redirects === false ? 0 : undefined });
  expectNoSetCookie(response);
  return response;
}

const offerLinks = (html: string): number => (html.match(/data-testid="offer-go"/g) ?? []).length;

function describeFlagState(
  label: string,
  o: { env: Record<string, string>; shown: boolean; origin: (app: IsolatedApp) => string },
) {
  test.describe(label, () => {
    let app: IsolatedApp;
    let world: World;
    let request: APIRequestContext;

    test.beforeAll(async ({ playwright }) => {
      test.setTimeout(300_000);
      app = await startIsolatedApp(`collected-public.spec.ts (${label})`, { env: o.env });
      world = seed(app);
      request = await playwright.request.newContext({ baseURL: app.origin });
    });
    test.afterAll(async () => {
      await request?.dispose();
      app?.stop();
    });

    test('starts and is healthy (AC 36), and never printed the refusal', async () => {
      const health = await request.get('/api/health');
      expect(health.status()).toBe(200);
      expect(app.logs()).not.toContain('start refused');
    });

    test('non-vacuity: the unmarked product and the demo catalogue are public, so an absence below means something', async () => {
      const page = await get(request, `/producto/${U.slug}`);
      expect(page.status()).toBe(200);
      expect(await page.text()).toContain(U.title);
      const go = await get(request, `/go/${world.offerUHand}`, { redirects: false });
      expect(go.status()).toBe(302);
      // The hand-written offer is a counted click; a marked one never is.
      expect(clicks(app)).toBe(1);
    });

    test(`the marked product page ${o.shown ? 'shows' : 'is a 404, as one that does not exist'} (ACs 16, 26)`, async () => {
      const page = await get(request, `/producto/${M.slug}`);
      const html = await page.text();
      if (o.shown) {
        expect(page.status()).toBe(200);
        expect(html).toContain(M.title);
        expect(normaliseSpaces(stripScripts(html))).toContain('12,34');
      } else {
        expect(page.status()).toBe(404);
        expectServerRenderedNotFound(html, siteName, 'marked product');
        expect(html).not.toContain(M.title);
        // A car-filtered address is a 404 too.
        const withCar = await get(request, `/producto/${M.slug}?coche=${CAR.slug}`);
        expect(withCar.status()).toBe(404);
      }
    });

    test('the marked product page, when it exists, is noindex with no canonical (AC 20)', async ({ browser }) => {
      test.skip(!o.shown, 'with the flag off there is no marked page to read');
      const html = await (await get(request, `/producto/${M.slug}`)).text();
      const { page, close } = await openRawHtml(browser, html);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await close();
    });

    test(`the offer list of the unmarked product ${o.shown ? 'adds' : 'does not add'} the marked offer, and the page is indexable on its public origin (ACs 17, 21)`, async ({ browser }) => {
      const html = await (await get(request, `/producto/${U.slug}`)).text();
      expect(offerLinks(html)).toBe(o.shown ? 2 : 1);
      const { page, close } = await openRawHtml(browser, html);
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${o.origin(app)}/producto/${U.slug}`);
      await close();
      expect(html).toContain(U.title);
      expect(html).not.toContain(M.title);
    });

    test(`the category of the marked product ${o.shown ? 'lists it' : 'is empty'}, and is noindex with no canonical either way (ACs 15, 22)`, async ({ browser }) => {
      const response = await get(request, `/categoria/${world.cm}`);
      expect(response.status()).toBe(200);
      const html = await response.text();
      if (o.shown) expect(html).toContain(M.title);
      else expect(html).not.toContain(M.title);
      const { page, close } = await openRawHtml(browser, html);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await close();
    });

    test('the category that holds the unmarked product is indexable, with the marked offer not counted as one (AC 22)', async ({ browser }) => {
      const html = await (await get(request, `/categoria/${world.cu}`)).text();
      const { page, close } = await openRawHtml(browser, html);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${o.origin(app)}/categoria/${world.cu}`);
      await close();
      expect(html).toContain(U.title);
    });

    test(`search ${o.shown ? 'finds' : 'does not find'} the marked product by its title and its part number (AC 18)`, async () => {
      for (const term of [M.term, M.part]) {
        const html = await (await get(request, `/buscar?q=${encodeURIComponent(term)}`)).text();
        if (o.shown) expect(html, term).toContain(M.title);
        else {
          expect(html, term).not.toContain(M.title);
          expect(normaliseSpaces(stripScripts(html)), term).toContain(messages.Search.noResultsHeading);
        }
      }
      // The unmarked product is found either way.
      expect(await (await get(request, `/buscar?q=${U.term}`)).text()).toContain(U.title);
    });

    test(`the home page counts ${o.shown ? 'both' : 'only the unmarked'} product${o.shown ? 's' : ''} beside the ${DEMO_COUNTS.publicProducts} demo ones (AC 15)`, async ({ browser }) => {
      const html = await (await get(request, '/')).text();
      const { page, close } = await openRawHtml(browser, html);
      const expected = DEMO_COUNTS.publicProducts + 1 + (o.shown ? 1 : 0);
      await expect(page.getByTestId('home-all-count')).toHaveText(icuPlural(messages.Home.productCount, expected));
      await close();
    });

    test(`/go for the marked offers ${o.shown ? 'redirects to the offer address, with no click' : 'answers 404 as for an unknown offer, with no click'} (ACs 19, 24)`, async () => {
      const before = clicks(app);
      const unknown = await get(request, '/go/2000000000', { redirects: false });
      for (const offer of [world.offerM, world.offerUMarked]) {
        const response = await get(request, `/go/${offer}`, { redirects: false });
        expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
        if (o.shown) {
          expect(response.status()).toBe(302);
          expect(response.headers().location).toBe(offer === world.offerM ? M.link : U.markedLink);
        } else {
          expect(response.status()).toBe(404);
          expect(response.status()).toBe(unknown.status());
          expect(response.headers().location).toBeUndefined();
        }
      }
      expect(clicks(app)).toBe(before);
    });

    test('the sitemap lists the unmarked product and its category, and no marked product or category, flag on or off (AC 23)', async () => {
      const index = await (await get(request, '/sitemap.xml')).text();
      const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
      expect(locs.some((loc) => loc.endsWith('/sitemaps/paginas.xml'))).toBe(true);
      expect(locs.some((loc) => /\/sitemaps\/productos-1\.xml$/.test(loc))).toBe(true);
      let all = '';
      for (const loc of locs) {
        const file = await get(request, new URL(loc).pathname);
        expect(file.status()).toBe(200);
        all += await file.text();
      }
      expect(all).toContain(`<loc>${o.origin(app)}/producto/${U.slug}</loc>`);
      expect(all).toContain(`<loc>${o.origin(app)}/categoria/${world.cu}</loc>`);
      expect(all).not.toContain(M.slug);
      expect(all).not.toContain(`/categoria/${world.cm}<`);
      expect(all).not.toContain('/go/');
    });

    test('no page marks a row as collected, and no public response sets a cookie (AC 26, OD-6)', async () => {
      for (const path of ['/', `/producto/${U.slug}`, `/categoria/${world.cu}`, `/categoria/${world.cm}`, `/buscar?q=${U.term}`, ...(o.shown ? [`/producto/${M.slug}`] : [])]) {
        const html = stripScripts(await (await get(request, path)).text());
        expect(html, path).not.toMatch(/recopilad|uso local|ajuste local|collected/i);
      }
    });
  });
}

describeFlagState('flag off beside a public SITE_URL (a deploy)', {
  env: { LOCAL_COLLECTED_DATA: 'false', SITE_URL: PUBLIC_ORIGIN },
  shown: false,
  origin: () => PUBLIC_ORIGIN,
});

describeFlagState('flag on beside a loopback SITE_URL (the owner\'s local stack)', {
  env: { LOCAL_COLLECTED_DATA: 'true' },
  shown: true,
  origin: (app) => app.origin,
});
