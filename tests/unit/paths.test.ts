import { describe, expect, it } from 'vitest';

import {
  absoluteUrl,
  categoryListingPath,
  categoryPath,
  productPath,
  SEARCH_PATH,
  searchPath,
} from '@/server/catalogue/paths';

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

describe('searchPath (S5.4, AC 21, 22)', () => {
  it('is the bare search path for an empty term, and keeps a page above 1', () => {
    expect(SEARCH_PATH).toBe('/buscar');
    expect(searchPath({ term: '' })).toBe('/buscar');
    expect(searchPath({ term: '', page: 3 })).toBe('/buscar?pagina=3');
  });

  it('omits the page for page 1 and for none, and puts it after q for later pages', () => {
    expect(searchPath({ term: 'filtro' })).toBe('/buscar?q=filtro');
    expect(searchPath({ term: 'filtro', page: 1 })).toBe('/buscar?q=filtro');
    expect(searchPath({ term: 'filtro', page: 2 })).toBe('/buscar?q=filtro&pagina=2');
  });

  it('encodes the term so it round-trips through URLSearchParams', () => {
    for (const term of ['5W-30 aceite', 'a&b=c', '100%', 'año ñ', '<b>x</b>', '😀']) {
      const url = new URL(searchPath({ term, page: 2 }), 'https://example.test');
      expect(url.searchParams.get('q')).toBe(term);
      expect(url.searchParams.get('pagina')).toBe('2');
      expect(url.pathname).toBe('/buscar');
    }
    expect(searchPath({ term: 'a b&c' })).toBe('/buscar?q=a+b%26c');
  });
});
