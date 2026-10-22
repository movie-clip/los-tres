import { describe, expect, it } from 'vitest';

import { absoluteUrl, categoryPath, productPath } from '@/server/catalogue/paths';

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
