import { describe, expect, it } from 'vitest';

import { parseBrandParam, parseSortParam } from '@/server/catalogue/category-query';
import { parsePageParam } from '@/server/catalogue/page-param';
import { toSearchParamsShape } from '@/server/catalogue/missing-page';

// S11.7: the proxy reads `?pagina`, `?marca` and `?orden` from a URL in the shape Next gives a page as
// `searchParams`, so a repeated parameter must parse in the proxy exactly as it does in the page.

describe('toSearchParamsShape', () => {
  it('gives an empty object for no parameters', () => {
    expect(toSearchParamsShape(new URLSearchParams(''))).toEqual({});
  });

  it('leaves an absent key out, so reading it is undefined', () => {
    const shape = toSearchParamsShape(new URLSearchParams('marca=bosch'));
    expect(shape.pagina).toBeUndefined();
    expect('pagina' in shape).toBe(false);
  });

  it('gives a key present once as a string', () => {
    expect(toSearchParamsShape(new URLSearchParams('pagina=2&marca=bosch'))).toEqual({
      pagina: '2',
      marca: 'bosch',
    });
  });

  it('gives a key present twice or more as an array in URL order', () => {
    const shape = toSearchParamsShape(new URLSearchParams('pagina=2&pagina=3&marca=a&pagina=4'));
    expect(shape.pagina).toEqual(['2', '3', '4']);
    expect(shape.marca).toBe('a');
  });

  it('keeps an empty value as an empty string, not as absent', () => {
    expect(toSearchParamsShape(new URLSearchParams('pagina=')).pagina).toBe('');
  });

  it('keeps a repeated key with empty values as an array', () => {
    expect(toSearchParamsShape(new URLSearchParams('pagina=&pagina=')).pagina).toEqual(['', '']);
  });

  it('decodes values the way the URL does', () => {
    expect(toSearchParamsShape(new URLSearchParams('marca=a%20b+c')).marca).toBe('a b c');
  });

  it('feeds the page parsers the same values the page receives', () => {
    const read = (query: string) => toSearchParamsShape(new URLSearchParams(query));
    // single
    expect(parsePageParam(read('pagina=2').pagina)).toBe(2);
    // missing
    expect(parsePageParam(read('').pagina)).toBe(1);
    // repeated: an array reads as page 1, for the page and for the proxy alike
    expect(parsePageParam(read('pagina=2&pagina=3').pagina)).toBe(1);
    expect(parseBrandParam(read('marca=bosch&marca=mahle').marca)).toBeNull();
    expect(parseBrandParam(read('marca=bosch').marca)).toBe('bosch');
    expect(parseSortParam(read('orden=nombre&orden=precio-desc').orden)).toBe(parseSortParam(undefined));
  });
});
