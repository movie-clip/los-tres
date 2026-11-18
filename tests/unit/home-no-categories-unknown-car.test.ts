import { describe, expect, it, vi } from 'vitest';

// The empty home (no public category) opened with an unrecognised car: the demo data always has
// categories, so the state is reached by a render with the tree mocked empty. The car notice
// still shows above the one h1, the empty state shows, and no hero search form renders.

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/server/car/context', async () => {
  const state = await import('@/server/car/state');
  return {
    getCarContext: async () => ({ state: 'unrecognised', raw: 'no-existe', path: null }),
    openedWithCoche: state.openedWithCoche,
    selectedSlug: state.selectedSlug,
  };
});
vi.mock('@/server/catalogue/category-tree', () => ({
  getPublicCategoryTree: async () => [],
}));

describe('home page with no public category and an unrecognised car', () => {
  it('shows the notice before the single h1, the empty state, and no search form', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { default: HomePage } = await import('@/app/(public)/page');
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('unknownNotice');
    expect(html).toContain('data-testid="category-empty"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain('<form');
    expect(html.indexOf('unknownNotice')).toBeLessThan(html.indexOf('<h1'));
  });
});
