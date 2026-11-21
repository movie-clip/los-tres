import { describe, expect, it } from 'vitest';

import {
  ADMIN_PRODUCTS_PAGE_SIZE,
  adminProductHref,
  adminProductListHref,
  parseAdminProductListQuery,
  parseHideTarget,
} from '@/server/admin/product-rules';

// S2.4: the pure rules of the admin product list and the hide actions. The list
// reads the same `q` and `pagina` the public pages read (ACs 17, 20), and the
// product page rebuilds the way back from them (AC 31).

describe('parseAdminProductListQuery (ACs 17, 19, 20)', () => {
  it('reads nothing as the first page of every product', () => {
    expect(parseAdminProductListQuery({})).toEqual({ term: '', hiddenOnly: false, page: 1 });
  });

  it('cleans the term as the public search does: control characters, blanks and 100 code points', () => {
    expect(parseAdminProductListQuery({ q: '  oc\u0000  1234\t' }).term).toBe('oc 1234');
    expect(parseAdminProductListQuery({ q: ['first', 'second'] }).term).toBe('first');
    const long = parseAdminProductListQuery({ q: '😀'.repeat(150) }).term;
    expect(Array.from(long)).toHaveLength(100);
    expect(parseAdminProductListQuery({ q: '   ' }).term).toBe('');
  });

  it('turns the hidden-only filter on only for the text 1', () => {
    expect(parseAdminProductListQuery({ ocultos: '1' }).hiddenOnly).toBe(true);
    for (const value of ['0', '', 'true', 'on', ' 1', '01', undefined, ['1']]) {
      expect(parseAdminProductListQuery({ ocultos: value }).hiddenOnly, String(value)).toBe(false);
    }
  });

  it('reads a page that is not a whole number above zero as page 1, and keeps a larger one', () => {
    expect(parseAdminProductListQuery({ pagina: '3' }).page).toBe(3);
    for (const value of ['0', '-2', '2.5', 'dos', '', ' 2', undefined, ['2']]) {
      expect(parseAdminProductListQuery({ pagina: value }).page, String(value)).toBe(1);
    }
  });

  it('never throws on awkward input', () => {
    expect(() =>
      parseAdminProductListQuery({ q: ['\u0000'], ocultos: ['1', '1'], pagina: '99999999999999999999999' }),
    ).not.toThrow();
  });
});

describe('the list and product hrefs (AC 31)', () => {
  it('names the bare list when no parameter is set', () => {
    expect(adminProductListHref({ term: '', hiddenOnly: false, page: 1 })).toBe('/admin/productos');
    expect(adminProductHref(7, { term: '', hiddenOnly: false, page: 1 })).toBe('/admin/productos/7');
  });

  it('carries q only when non-empty, ocultos=1 only when on, pagina only above 1', () => {
    expect(adminProductListHref({ term: 'aceite', hiddenOnly: false, page: 1 })).toBe('/admin/productos?q=aceite');
    expect(adminProductListHref({ term: '', hiddenOnly: true, page: 1 })).toBe('/admin/productos?ocultos=1');
    expect(adminProductListHref({ term: '', hiddenOnly: false, page: 2 })).toBe('/admin/productos?pagina=2');
    expect(adminProductListHref({ term: 'aceite', hiddenOnly: true, page: 3 })).toBe(
      '/admin/productos?q=aceite&ocultos=1&pagina=3',
    );
    expect(adminProductHref(42, { term: 'aceite', hiddenOnly: true, page: 3 })).toBe(
      '/admin/productos/42?q=aceite&ocultos=1&pagina=3',
    );
  });

  it('encodes the term with URLSearchParams, so a crafted term cannot add a parameter or leave the path', () => {
    const href = adminProductListHref({ term: 'a&ocultos=1 #x/../é', hiddenOnly: false, page: 1 });
    expect(href).toBe('/admin/productos?q=a%26ocultos%3D1+%23x%2F..%2F%C3%A9');
    const parsed = new URL(href, 'http://x.test');
    expect(parsed.pathname).toBe('/admin/productos');
    expect([...parsed.searchParams.keys()]).toEqual(['q']);
    expect(parsed.searchParams.get('q')).toBe('a&ocultos=1 #x/../é');
  });

  it('round-trips through the parser', () => {
    const query = { term: 'oc 1234', hiddenOnly: true, page: 4 };
    const params = new URL(adminProductListHref(query), 'http://x.test').searchParams;
    expect(
      parseAdminProductListQuery({
        q: params.get('q') ?? undefined,
        ocultos: params.get('ocultos') ?? undefined,
        pagina: params.get('pagina') ?? undefined,
      }),
    ).toEqual(query);
  });
});

describe('parseHideTarget (AC 4)', () => {
  it('maps hide to true and unhide to false', () => {
    expect(parseHideTarget('hide')).toBe(true);
    expect(parseHideTarget('unhide')).toBe(false);
  });

  it('refuses everything else: absent, an array, other text, a different case, a non-string', () => {
    for (const value of [null, undefined, '', 'Hide', 'UNHIDE', 'toggle', 'hide ', ['hide'], 1, true, new File([], 'hide')]) {
      expect(parseHideTarget(value), String(value)).toBeNull();
    }
  });
});

describe('the page size', () => {
  it('is 50', () => {
    expect(ADMIN_PRODUCTS_PAGE_SIZE).toBe(50);
  });
});
