import { describe, expect, it, vi } from 'vitest';

import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';
import type { PublicCategoryPage } from '@/server/catalogue/category-page';
import type { CarContext } from '@/server/car/state';

// The `fit-change-car` link of the all-left-out state (S5.8), on the category page and on the
// search page, as the page source renders it (US-5.7 AC 15 and AC 34, decision D-2 of run
// 2026-11-25-381): it is the car control's own change link. It leads to `/mi-coche` with the
// selected car's make and model, and the car travels inside `volver` (the page the visitor
// came from, with `coche`); it carries no top-level `coche`. The loaders are mocked, the pages
// are rendered, and the expected hrefs are written out here rather than built by `carLinks`.

const { carHolder, categoryHolder, searchHolder } = vi.hoisted(() => ({
  carHolder: { current: null as unknown },
  categoryHolder: { current: null as unknown },
  searchHolder: { current: null as unknown },
}));

// Message keys stand for the copy: nothing here reads Spanish text.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/server/car/context', async () => {
  const state = await import('@/server/car/state');
  return {
    getCarContext: async () => carHolder.current,
    openedWithCoche: state.openedWithCoche,
    selectedSlug: state.selectedSlug,
  };
});
vi.mock('@/server/catalogue/category-page', () => ({
  getPublicCategoryPage: async () => categoryHolder.current,
}));
vi.mock('@/server/catalogue/category-tree', () => ({ getPublicSubcategories: async () => [] }));
vi.mock('@/server/catalogue/search-page', () => ({
  getPublicSearchPage: async () => searchHolder.current,
}));

const ENTRY = VEHICLE_CATALOGUE[0];
const SLUG = ENTRY.slug;

function selectedCar(path: string): CarContext {
  return {
    state: 'selected',
    vehicle: {
      id: 1,
      slug: ENTRY.slug,
      makeSlug: ENTRY.makeSlug,
      modelSlug: ENTRY.modelSlug,
      name: `${ENTRY.make} ${ENTRY.model}`,
    },
    path,
  };
}

function allLeftOutCategory(brand: string | null): PublicCategoryPage {
  const mahle = { slug: 'mahle', label: 'Mahle', productCount: 0 };
  return {
    slug: 'filtros',
    name: 'Filtros',
    ancestors: [],
    page: 1,
    pageCount: 1,
    productCount: 0,
    categoryProductCount: 2,
    state: 'all-left-out',
    fit: { fitsCount: 0, unknownCount: 0, leftOutCount: 2 },
    products: [],
    brands: [mahle],
    selectedBrand: brand === null ? null : mahle,
    sort: 'price-asc',
    demoOnly: false,
    indexable: true,
  };
}

/** The anchors of the empty-state section, in document order, as { testid, href }. */
function emptyStateAnchors(html: string): { testId: string | null; href: string }[] {
  const start = html.indexOf('data-testid="category-empty"');
  expect(start).toBeGreaterThan(-1);
  const section = html.slice(start, html.indexOf('</section>', start));
  return [...section.matchAll(/<a\b[^>]*>/g)].map(([tag]) => ({
    testId: /data-testid="([^"]*)"/.exec(tag)?.[1] ?? null,
    // Attribute text is HTML-escaped: `&` is `&amp;`.
    href: (/href="([^"]*)"/.exec(tag)?.[1] ?? '').replaceAll('&amp;', '&'),
  }));
}

function expectChangeLink(href: string, volver: string): void {
  // Written out, not computed by carLinks: a bare change href with the car in volver.
  expect(href).toBe(
    `/mi-coche?marca=${ENTRY.makeSlug}&modelo=${ENTRY.modelSlug}&volver=${encodeURIComponent(volver)}`,
  );
  const url = new URL(href, 'http://h.invalid');
  expect(url.pathname).toBe('/mi-coche');
  expect(url.searchParams.get('marca')).toBe(ENTRY.makeSlug);
  expect(url.searchParams.get('modelo')).toBe(ENTRY.modelSlug);
  expect(url.searchParams.get('volver')).toBe(volver);
  // The car is inside volver, never beside it.
  expect(url.searchParams.has('coche')).toBe(false);
  expect(href).not.toMatch(/[?&]coche=/);
}

async function renderCategory(path: string, brand: string | null) {
  carHolder.current = selectedCar(path);
  categoryHolder.current = allLeftOutCategory(brand);
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: CategoryPage } = await import('@/app/(public)/categoria/[slug]/page');
  return renderToStaticMarkup(
    await CategoryPage({
      params: Promise.resolve({ slug: 'filtros' }),
      searchParams: Promise.resolve(brand === null ? {} : { marca: brand }),
    }),
  );
}

describe('fit-change-car on the category page, all-left-out state', () => {
  it('is the only action with no brand, and leads to the picker with the car inside volver', async () => {
    const html = await renderCategory('/categoria/filtros', null);

    const anchors = emptyStateAnchors(html);
    expect(anchors.map((anchor) => anchor.testId)).toEqual(['fit-change-car']);
    expectChangeLink(anchors[0].href, `/categoria/filtros?coche=${SLUG}`);
  });

  it('is the second action with a brand selected, after the filter removal, and keeps the brand in volver', async () => {
    const html = await renderCategory('/categoria/filtros?marca=mahle', 'mahle');

    const anchors = emptyStateAnchors(html);
    // First the filter removal (its own link keeps the car as a plain coche), then the change link.
    expect(anchors.map((anchor) => anchor.testId)).toEqual([
      'category-empty-action',
      'fit-change-car',
    ]);
    expect(anchors[0].href).toBe(`/categoria/filtros?coche=${SLUG}`);
    expectChangeLink(anchors[1].href, `/categoria/filtros?marca=mahle&coche=${SLUG}`);
    expect(html.match(/data-testid="fit-change-car"/g)).toHaveLength(1);
  });
});

describe('fit-change-car on the search page, all-left-out state', () => {
  it('is the page action and leads to the picker with the searched page and the car inside volver', async () => {
    carHolder.current = selectedCar('/buscar?q=filtro');
    searchHolder.current = { state: 'all-left-out', term: 'filtro', leftOutCount: 2 };
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { default: SearchPage } = await import('@/app/(public)/buscar/page');

    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ q: 'filtro' }) }),
    );

    const anchors = emptyStateAnchors(html);
    expect(anchors.map((anchor) => anchor.testId)).toEqual(['fit-change-car']);
    expectChangeLink(anchors[0].href, `/buscar?q=filtro&coche=${SLUG}`);
  });
});
