import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';
import { CAR_HEADER, PATH_HEADER } from '@/server/car/request';
import type { ActiveVehicle } from '@/server/car/vehicles';

import { startRequest } from '../support/next-request';

// The change link of the public header, as the server sends it (US-5.7 AC 43, issue #387): with
// a car selected, the "Cambiar" link of the car control is a plain anchor to `/mi-coche` carrying
// the car's make and model and the current page with `coche` inside `volver`, and it carries no
// top-level `coche`. The render is `PublicChrome` itself, static, with only its inputs mocked at
// module boundaries: the request headers (tests/support/next-request.ts, with the two headers the
// proxy sets), the vehicle read (no database), next-intl/server (a real createTranslator over
// es-ES, because the chrome calls `.rich`) and the site name. `getCarContext`, `carLinks`,
// `withCar`, `SiteHeader` and `CarControl` run unmocked, so the href is read out of the markup
// PublicChrome produced. Expected hrefs are written out here, never built by `carLinks`.
//
// What this does not observe: the proxy writing `x-car-slug` and `x-car-path` from the URL (the
// proxy tests and J7 of the e2e do), and the swap of the link for a button once the page
// hydrates (`car-links.spec.ts` J4 does). A static render is the page without script, which is the
// only state where this element is an `<a href>`.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);

vi.mock('@/server/car/vehicles', async () => {
  const { VEHICLE_CATALOGUE: catalogue } = await import('@/db/vehicle-catalogue');
  const [entry] = catalogue;
  const vehicle: ActiveVehicle = {
    id: 1,
    slug: entry.slug,
    make: entry.make,
    makeSlug: entry.makeSlug,
    model: entry.model,
    modelSlug: entry.modelSlug,
    generation: entry.generation,
    yearFrom: entry.yearFrom,
    yearTo: entry.yearTo,
    engine: entry.engine,
    fuel: entry.fuel,
    powerCv: entry.powerCv,
  };
  return { readActiveVehicles: async () => [vehicle] };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('use-intl/core');
  const all = (await import('../../messages/es-ES.json')).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'es-ES', messages: all, namespace } as never) as unknown,
  };
});

vi.mock('@/config/site', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/site')>()),
  getSiteName: () => 'Sitio de prueba',
}));

const ENTRY = VEHICLE_CATALOGUE[0];
const SLUG = ENTRY.slug;

/** The header of a request the proxy has marked with the car and the page path, rendered to markup. */
async function renderHeader(path: string): Promise<string> {
  startRequest({ [CAR_HEADER]: SLUG, [PATH_HEADER]: path });
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { PublicChrome } = await import('@/app/PublicChrome');
  return renderToStaticMarkup(await PublicChrome({ children: null }));
}

/** The `car-change` anchors of the markup, as their href with HTML escaping undone. */
function changeLinks(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*data-testid="car-change"[^>]*>/g)].map(([tag]) =>
    (/href="([^"]*)"/.exec(tag)?.[1] ?? '').replaceAll('&amp;', '&'),
  );
}

function expectNoTopLevelCoche(href: string): void {
  const url = new URL(href, 'http://h.invalid');
  expect(url.pathname).toBe('/mi-coche');
  expect(url.searchParams.has('coche')).toBe(false);
  expect(url.searchParams.get('marca')).toBe(ENTRY.makeSlug);
  expect(url.searchParams.get('modelo')).toBe(ENTRY.modelSlug);
}

beforeEach(() => {
  startRequest();
});

describe('the public header change link, rendered by PublicChrome (US-5.7 AC 43, #387)', () => {
  it('leads to the picker with the car\'s make and model and the page, with the car, in volver (a path with no query)', async () => {
    const hrefs = changeLinks(await renderHeader('/categoria/filtros'));

    expect(hrefs).toEqual([
      `/mi-coche?marca=seat&modelo=seat-leon-iii&volver=%2Fcategoria%2Ffiltros%3Fcoche%3D${SLUG}`,
    ]);
    expectNoTopLevelCoche(hrefs[0]);
    expect(new URL(hrefs[0], 'http://h.invalid').searchParams.get('volver')).toBe(`/categoria/filtros?coche=${SLUG}`);
  });

  it('keeps the page\'s own query inside volver, with the car after it (a path with a query)', async () => {
    const hrefs = changeLinks(await renderHeader('/categoria/filtros?pagina=2'));

    expect(hrefs).toEqual([
      `/mi-coche?marca=seat&modelo=seat-leon-iii&volver=%2Fcategoria%2Ffiltros%3Fpagina%3D2%26coche%3D${SLUG}`,
    ]);
    expectNoTopLevelCoche(hrefs[0]);
    expect(new URL(hrefs[0], 'http://h.invalid').searchParams.get('volver')).toBe(
      `/categoria/filtros?pagina=2&coche=${SLUG}`,
    );
  });
});
