import { describe, expect, it } from 'vitest';

import { absoluteUrl, categoryListingPath, categoryPath, productPath } from '@/server/catalogue/paths';

describe('catalogue paths', () => {
  it('builds the product path', () => {
    expect(productPath('filtro-a')).toBe('/producto/filtro-a');
  });

  it('builds the bare category path for page 1 and by default', () => {
    expect(categoryPath('filtros')).toBe('/categoria/filtros');
    expect(categoryPath('filtros', 1)).toBe('/categoria/filtros');
  });

  it('adds ?pagina=n only for pages after the first', () => {
    expect(categoryPath('filtros', 2)).toBe('/categoria/filtros?pagina=2');
    expect(categoryPath('filtros', 17)).toBe('/categoria/filtros?pagina=17');
  });

  it('joins an origin and a path without a double slash', () => {
    expect(absoluteUrl('https://example.test', '/producto/x')).toBe('https://example.test/producto/x');
    expect(absoluteUrl('https://example.test', '/')).toBe('https://example.test/');
  });
});

describe('categoryListingPath (S11.4)', () => {
  it('is the bare category path with no state, and for the default state', () => {
    expect(categoryListingPath('filtros', {})).toBe('/categoria/filtros');
    expect(categoryListingPath('filtros', { brand: null, sort: 'price-asc', page: 1 })).toBe('/categoria/filtros');
  });

  it('omits a page below 2, so page 1 never shows ?pagina=1', () => {
    expect(categoryListingPath('filtros', { page: 0 })).toBe('/categoria/filtros');
    expect(categoryListingPath('filtros', { page: 1 })).toBe('/categoria/filtros');
    expect(categoryListingPath('filtros', { page: 2 })).toBe('/categoria/filtros?pagina=2');
  });

  it('writes the public sort value, not the code name', () => {
    expect(categoryListingPath('filtros', { sort: 'price-desc' })).toBe('/categoria/filtros?orden=precio-desc');
    expect(categoryListingPath('filtros', { sort: 'name' })).toBe('/categoria/filtros?orden=nombre');
  });

  it('writes the brand slug', () => {
    expect(categoryListingPath('filtros', { brand: 'mann-filter' })).toBe('/categoria/filtros?marca=mann-filter');
  });

  it('orders the parameters marca, orden, pagina whatever the order of the keys', () => {
    expect(categoryListingPath('filtros', { page: 3, sort: 'name', brand: 'mahle' })).toBe(
      '/categoria/filtros?marca=mahle&orden=nombre&pagina=3',
    );
    expect(categoryListingPath('filtros', { brand: 'mahle', sort: 'name', page: 3 })).toBe(
      '/categoria/filtros?marca=mahle&orden=nombre&pagina=3',
    );
  });

  it('drops only the defaults in a mixed state', () => {
    expect(categoryListingPath('filtros', { brand: 'bosch', sort: 'price-asc', page: 2 })).toBe(
      '/categoria/filtros?marca=bosch&pagina=2',
    );
    expect(categoryListingPath('filtros', { brand: null, sort: 'price-desc', page: 2 })).toBe(
      '/categoria/filtros?orden=precio-desc&pagina=2',
    );
  });

  it('leaves categoryPath as the canonical-only builder: pagina and nothing else', () => {
    expect(categoryPath('filtros', 2)).toBe('/categoria/filtros?pagina=2');
  });
});
