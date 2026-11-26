import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXED_CATEGORY_TREE } from '@/db/category-tree';
import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';
import type { CategoryProductCard, PublicCategoryPage } from '@/server/catalogue/category-page';
import type { CarContext } from '@/server/car/state';

// #313: the root category page's links to its children, as the page source renders them. The loaders are
// mocked and the page is rendered (the pattern of fit-change-car-link.test.ts), so what is proved here is the
// page's composition: where the group sits, when the read is made, and what each href carries (04-design
// D-T3 to D-T5; AC 1, 2, 4 to 8, 10). Message keys stand for the copy. The read itself, the tree rule and
// the visibility are tests/integration/category-tree.test.ts.

const { carHolder, categoryHolder, subcategoriesRead } = vi.hoisted(() => ({
  carHolder: { current: null as unknown },
  categoryHolder: { current: null as unknown },
  subcategoriesRead: vi.fn(),
}));

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
vi.mock('@/server/catalogue/category-tree', () => ({
  getPublicSubcategories: subcategoriesRead,
}));

const ROOT = FIXED_CATEGORY_TREE.slug;
const CHILDREN = FIXED_CATEGORY_TREE.children;
const ENTRY = VEHICLE_CATALOGUE[0];

const NO_CAR: CarContext = { state: 'none', path: null };
const UNRECOGNISED_CAR: CarContext = { state: 'unrecognised', raw: 'no-existe', path: null };
const SELECTED_CAR: CarContext = {
  state: 'selected',
  vehicle: {
    id: 1,
    slug: ENTRY.slug,
    makeSlug: ENTRY.makeSlug,
    modelSlug: ENTRY.modelSlug,
    name: `${ENTRY.make} ${ENTRY.model}`,
  },
  path: null,
};

type Request = { marca?: string; orden?: string; pagina?: string };

const card = (fitGroup: CategoryProductCard['fitGroup']): CategoryProductCard => ({
  slug: 'producto-uno',
  title: 'Filtro uno',
  brand: 'Mahle',
  lowestPriceCents: 1149,
  offerCount: 2,
  categorySlug: CHILDREN[1].slug,
  partNumber: null,
  fitGroup,
});

/** A root or a child in the given state, shaped as the loader returns it. */
function categoryIn(
  state: PublicCategoryPage['state'],
  o: { slug?: string; ancestors?: boolean; withCar?: boolean; page?: number; brand?: boolean } = {},
): PublicCategoryPage {
  const mahle = { slug: 'mahle', label: 'Mahle', productCount: 3 };
  const other = { slug: 'bosch', label: 'Bosch', productCount: 2 };
  const listed = state === 'results';
  return {
    slug: o.slug ?? ROOT,
    name: 'Categoria de prueba',
    ancestors: o.ancestors === true ? [{ slug: ROOT, name: 'Raiz' }] : [],
    page: o.page ?? 1,
    pageCount: o.page === undefined ? 1 : 3,
    productCount: listed ? 5 : 0,
    categoryProductCount: state === 'empty-category' ? 0 : 5,
    state,
    fit:
      o.withCar === true
        ? { fitsCount: listed ? 1 : 0, unknownCount: 0, leftOutCount: listed ? 0 : 5 }
        : null,
    products: listed ? [card(o.withCar === true ? 'fits' : null)] : [],
    brands: state === 'empty-category' ? [] : [mahle, other],
    selectedBrand: o.brand === true ? mahle : null,
    sort: 'price-asc',
    demoOnly: false,
    indexable: true,
  };
}

const SUBCATEGORIES = CHILDREN.map(({ slug, name }) => ({ slug, name }));

async function render(
  category: PublicCategoryPage,
  car: CarContext,
  subcategories: { slug: string; name: string }[] = SUBCATEGORIES,
  request: Request = {},
): Promise<string> {
  carHolder.current = car;
  categoryHolder.current = category;
  subcategoriesRead.mockResolvedValue(subcategories);
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: CategoryPage } = await import('@/app/(public)/categoria/[slug]/page');
  return renderToStaticMarkup(
    await CategoryPage({
      params: Promise.resolve({ slug: category.slug }),
      searchParams: Promise.resolve(request),
    }),
  );
}

/** The anchors inside the subcategory group, in document order. */
function groupLinks(html: string): { href: string; text: string }[] {
  const start = html.indexOf('data-testid="subcategory-links"');
  if (start === -1) return [];
  const group = html.slice(start, html.indexOf('</nav>', start));
  return [...group.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map(([, attributes, inner]) => ({
    // Attribute text is HTML-escaped: `&` is `&amp;`.
    href: (/href="([^"]*)"/.exec(attributes)?.[1] ?? '').replaceAll('&amp;', '&'),
    text: inner.replace(/<[^>]*>/g, ''),
  }));
}

/** Every anchor href of the page outside the group. */
function otherHrefs(html: string): string[] {
  const start = html.indexOf('data-testid="subcategory-links"');
  const rest = start === -1 ? html : html.slice(0, start) + html.slice(html.indexOf('</nav>', start));
  return [...rest.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(([, href]) => href.replaceAll('&amp;', '&'));
}

beforeEach(() => {
  subcategoriesRead.mockReset();
});

describe('the root page with results (AC 1, 2, 6)', () => {
  it('shows the five links in the order the read gave, with the category names, as plain anchors', async () => {
    const html = await render(categoryIn('results'), NO_CAR);

    expect(groupLinks(html)).toEqual(
      CHILDREN.map((child) => ({ href: `/categoria/${child.slug}`, text: child.name })),
    );
    expect(subcategoriesRead).toHaveBeenCalledWith(ROOT);
    // The group is named by the message key, and the anchors carry the test id of the contract.
    expect(html).toContain('subcategoriesLabel');
    expect(html.match(/data-testid="subcategory-link"/g)).toHaveLength(CHILDREN.length);
  });

  it('keeps the order of the read, whatever it is (the page does not sort)', async () => {
    const reversed = [...SUBCATEGORIES].reverse();
    const html = await render(categoryIn('results'), NO_CAR, reversed);

    expect(groupLinks(html).map((link) => link.text)).toEqual(reversed.map((child) => child.name));
  });

  it('sits after the title block and before the results panel', async () => {
    const html = await render(categoryIn('results'), NO_CAR);

    const group = html.indexOf('data-testid="subcategory-links"');
    expect(group).toBeGreaterThan(-1);
    expect(group).toBeGreaterThan(html.indexOf('</h1>'));
    expect(group).toBeLessThan(html.indexOf('data-testid="category-panel"'));
  });

  it('is not rendered inside the results panel or the listing', async () => {
    const html = await render(categoryIn('results'), NO_CAR);

    const group = html.indexOf('data-testid="subcategory-links"');
    const afterGroup = html.slice(html.indexOf('</nav>', group));
    expect(afterGroup).not.toContain('data-testid="subcategory-links"');
    expect(html.slice(html.indexOf('data-testid="category-panel"'))).not.toContain('subcategory-link');
  });
});

describe('what each href carries (AC 4, 5)', () => {
  it('is the bare category path with no car', async () => {
    const html = await render(categoryIn('results'), NO_CAR);

    expect(groupLinks(html).map((link) => link.href)).toEqual(
      CHILDREN.map((child) => `/categoria/${child.slug}`),
    );
  });

  it('is the bare category path with a car that is not recognised', async () => {
    const html = await render(categoryIn('results'), UNRECOGNISED_CAR);

    expect(groupLinks(html).map((link) => link.href)).toEqual(
      CHILDREN.map((child) => `/categoria/${child.slug}`),
    );
  });

  it('carries the selected car once and nothing else', async () => {
    const html = await render(categoryIn('results', { withCar: true }), SELECTED_CAR);

    expect(groupLinks(html).map((link) => link.href)).toEqual(
      CHILDREN.map((child) => `/categoria/${child.slug}?coche=${ENTRY.slug}`),
    );
  });

  it('drops marca, orden and pagina of the request on page 2 of a brand and sort, and keeps the car', async () => {
    const category = categoryIn('results', { page: 2, brand: true });
    const request = { marca: 'mahle', orden: 'precio-desc', pagina: '2' };

    const bare = await render({ ...category, sort: 'price-desc' }, NO_CAR, SUBCATEGORIES, request);
    const withCar = await render(
      { ...category, sort: 'price-desc', fit: { fitsCount: 1, unknownCount: 0, leftOutCount: 0 }, products: [card('fits')] },
      SELECTED_CAR,
      SUBCATEGORIES,
      request,
    );

    expect(groupLinks(bare).map((link) => link.href)).toEqual(
      CHILDREN.map((child) => `/categoria/${child.slug}`),
    );
    expect(groupLinks(withCar).map((link) => link.href)).toEqual(
      CHILDREN.map((child) => `/categoria/${child.slug}?coche=${ENTRY.slug}`),
    );
    // Non-vacuity: the rest of that page does keep the brand and the sort, so the request was read.
    const others = otherHrefs(bare).join(' ');
    expect(others).toContain('marca=mahle');
    expect(others).toContain('orden=');
    expect(others).toContain('pagina=');
  });
});

describe('the states that list (AC 7)', () => {
  it('shows the group on page 2 of the results', async () => {
    const html = await render(categoryIn('results', { page: 2 }), NO_CAR, SUBCATEGORIES, { pagina: '2' });

    expect(groupLinks(html)).toHaveLength(CHILDREN.length);
  });

  it('shows the group when a brand filter matches nothing (no-match)', async () => {
    const html = await render(categoryIn('no-match', { brand: true }), NO_CAR, SUBCATEGORIES, { marca: 'mahle' });

    expect(html).toContain('data-testid="category-empty"');
    expect(groupLinks(html)).toHaveLength(CHILDREN.length);
  });

  it('shows the group when every product is left out for the selected car (all-left-out)', async () => {
    const html = await render(categoryIn('all-left-out', { withCar: true }), SELECTED_CAR);

    expect(html).toContain('data-testid="category-empty"');
    expect(groupLinks(html).map((link) => link.href)).toEqual(
      CHILDREN.map((child) => `/categoria/${child.slug}?coche=${ENTRY.slug}`),
    );
  });
});

describe('no group (AC 8, 10)', () => {
  it('on a root in the empty-category state, and the read is not made', async () => {
    const html = await render(categoryIn('empty-category'), NO_CAR);

    expect(html).toContain('data-testid="category-empty"');
    expect(html).not.toContain('subcategory-link');
    expect(subcategoriesRead).not.toHaveBeenCalled();
  });

  it('on a subcategory page (it has ancestors), whatever the read would say, and the read is not made', async () => {
    const child = CHILDREN[0].slug;
    const html = await render(categoryIn('results', { slug: child, ancestors: true }), NO_CAR);

    expect(html).toContain('data-testid="category-card"');
    expect(html).not.toContain('subcategory-link');
    expect(subcategoriesRead).not.toHaveBeenCalled();
  });

  it('on a subcategory page with no results either', async () => {
    const child = CHILDREN[0].slug;
    const html = await render(categoryIn('no-match', { slug: child, ancestors: true }), NO_CAR);

    expect(html).not.toContain('subcategory-link');
    expect(subcategoriesRead).not.toHaveBeenCalled();
  });

  it('on a root whose read gives none, with the listing and the panel unchanged', async () => {
    const html = await render(categoryIn('results'), NO_CAR, []);

    expect(subcategoriesRead).toHaveBeenCalledWith(ROOT);
    expect(html).not.toContain('subcategory-link');
    expect(html).not.toContain('subcategoriesLabel');
    expect(html).toContain('data-testid="category-panel"');
    expect(html).toContain('data-testid="category-card"');
  });
});
