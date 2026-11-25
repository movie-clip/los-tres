import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { CAR } from '../support/car';
import { variant, type E2EVariant, type Variant } from '../support/e2e-stack';
import { normaliseSpaces } from '../support/messages';
import { expectNoSetCookie, expectServerRenderedNotFound, openRawHtml, stripScripts } from '../support/page-checks';

// S12.2 (decision 0017), ACs 15 to 21, 24, 26 and 36 on the REAL app, B6 of #339: marked rows (rows of a collected
// feed) are on no public page with the local flag off and are shown only with the flag on beside a loopback
// SITE_URL, noindex and never counted. Two variant apps of the e2e stack, on databases of their own
// (`app-flag-off` and `app-flag-on` of tests/e2e/compose.e2e.yaml, started and imported by the global setup,
// #363), each seeded the same way with invented rows written by psql: a collected file may never be placed in
// the owner's folder, so the rows are what an import of one would leave (the importer's marking is
// collected-import.test.ts, the sweep over every reader is collected-public-sweep.test.ts). The main e2e
// database is never touched, so this spec runs in the parallel project.
//
//   off  LOCAL_COLLECTED_DATA=false beside a PUBLIC https SITE_URL: the state of a deploy (AC 36: it starts)
//   on   LOCAL_COLLECTED_DATA=true beside the loopback SITE_URL of its own port: the owner's local stack
//
// The app refuses to start with the flag on beside a public SITE_URL, so that combination (the backstop,
// AC 37) is not a live case: collected-public-sweep.test.ts runs it over the readers, and
// collected-start.spec.ts proves the refusal. Serial within the file: each app is shared by its tests.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const siteName = (process.env.SITE_NAME ?? '').trim();

const M = { slug: 'e2e-marcado', title: 'Filtro Colibri E2E reservado', term: 'Colibri', part: 'E2E-77', price: 1234, link: 'https://tienda-recopilada.example/p/m1' };
const U = { slug: 'e2e-escrito', title: 'Filtro Pelicano E2E escrito', term: 'Pelicano', handPrice: 2000, markedPrice: 1000, markedLink: 'https://tienda-recopilada.example/p/u2' };

type World = { offerM: number; offerUMarked: number; offerUHand: number };

function seed(app: Variant): World {
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
  return { offerM: id(M.slug, 'm-1'), offerUMarked: id(U.slug, 'u-2'), offerUHand: id(U.slug, 'u-1') };
}

const clicks = (app: Variant): number => Number(app.psqlScalar('select count(*) from clicks'));

async function get(request: APIRequestContext, path: string, options: { redirects?: boolean } = {}): Promise<APIResponse> {
  const response = await request.get(path, { maxRedirects: options.redirects === false ? 0 : undefined });
  expectNoSetCookie(response);
  return response;
}

function describeFlagState(label: string, o: { service: E2EVariant; shown: boolean }) {
  test.describe(label, () => {
    let app: Variant;
    let world: World;
    let request: APIRequestContext;

    test.beforeAll(async ({ playwright }) => {
      app = variant(o.service);
      world = seed(app);
      request = await playwright.request.newContext({ baseURL: app.origin });
    });
    test.afterAll(async () => {
      await request?.dispose();
    });

    test('starts and is healthy (AC 36), never printed the refusal, and the unmarked product and the demo catalogue are public, so an absence below means something', async () => {
      const health = await request.get('/api/health');
      expect(health.status()).toBe(200);
      expect(app.logs()).not.toContain('start refused');

      const page = await get(request, `/producto/${U.slug}`);
      expect(page.status()).toBe(200);
      expect(await page.text()).toContain(U.title);
      const go = await get(request, `/go/${world.offerUHand}`, { redirects: false });
      expect(go.status()).toBe(302);
      // The hand-written offer is a counted click; a marked one never is.
      expect(clicks(app)).toBe(1);
    });

    test(`the marked product ${o.shown ? 'is shown, noindex with no canonical, found by search, and its /go redirects' : 'is a 404 as one that does not exist, is not found by search, and its /go answers 404'}, with no click (ACs 16, 18, 19, 20, 24, 26)`, async ({ browser }) => {
      const page = await get(request, `/producto/${M.slug}`);
      const html = await page.text();
      if (o.shown) {
        expect(page.status()).toBe(200);
        expect(html).toContain(M.title);
        expect(normaliseSpaces(stripScripts(html))).toContain('12,34');
        const raw = await openRawHtml(browser, html);
        await expect(raw.page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
        await expect(raw.page.locator('link[rel="canonical"]')).toHaveCount(0);
        await raw.close();
      } else {
        expect(page.status()).toBe(404);
        expectServerRenderedNotFound(html, siteName, 'marked product');
        expect(html).not.toContain(M.title);
        // A car-filtered address is a 404 too.
        const withCar = await get(request, `/producto/${M.slug}?coche=${CAR.slug}`);
        expect(withCar.status()).toBe(404);
      }

      for (const term of [M.term, M.part]) {
        const found = await (await get(request, `/buscar?q=${encodeURIComponent(term)}`)).text();
        if (o.shown) expect(found, term).toContain(M.title);
        else {
          expect(found, term).not.toContain(M.title);
          expect(normaliseSpaces(stripScripts(found)), term).toContain(messages.Search.noResultsHeading);
        }
      }
      // The unmarked product is found either way.
      expect(await (await get(request, `/buscar?q=${U.term}`)).text()).toContain(U.title);

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
  });
}

describeFlagState('flag off beside a public SITE_URL (a deploy)', {
  service: 'app-flag-off',
  shown: false,
});

describeFlagState("flag on beside a loopback SITE_URL (the owner's local stack)", {
  service: 'app-flag-on',
  shown: true,
});
