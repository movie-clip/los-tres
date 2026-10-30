import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// AC 38 and D-8: the header box hides only where the page owns a search form. A home page with
// no public category renders no hero form, so it must render no page marker either, and the
// header box (whose hide rule keys on that marker) stays shown. The demo data always has
// categories, so this state is reached by a render with the category tree mocked empty.

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
// S5.7: the page reads the selected car (request headers). Outside a request there are none: no car.
vi.mock('@/server/car/context', async () => {
  const state = await import('@/server/car/state');
  return {
    getCarContext: async () => ({ state: 'none', path: null }),
    openedWithCoche: state.openedWithCoche,
    selectedSlug: state.selectedSlug,
  };
});
vi.mock('@/server/catalogue/category-tree', () => ({
  getPublicCategoryTree: async () => [],
}));

describe('home page with no public category (AC 38)', () => {
  it('renders the empty state and no search form, so no page marker hides the header box', async () => {
    const { default: HomePage } = await import('@/app/(public)/page');
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('data-testid="category-empty"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('data-search-page');
  });

  it('is the only marker source: the marker is set by the page-owning form only', async () => {
    const { SearchForm } = await import('@/components/SearchForm');
    const base = {
      action: '/buscar',
      formLabel: 'Buscar',
      fieldLabel: 'Buscar un producto',
      button: 'Buscar',
      hint: null,
      value: null,
    };
    const hero = renderToStaticMarkup(createElement(SearchForm, { ...base, variant: 'hero' }));
    const header = renderToStaticMarkup(createElement(SearchForm, { ...base, variant: 'header' }));
    expect(hero).toContain('data-search-page');
    expect(header).not.toContain('data-search-page');
  });
});
