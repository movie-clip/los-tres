import { describe, expect, it } from 'vitest';

import { pageSeo } from '@/server/catalogue/seo';

const ORIGIN = 'https://example.test';

describe('pageSeo', () => {
  it('gives an indexable page with an origin an absolute canonical and no robots', () => {
    const seo = pageSeo(ORIGIN, '/producto/x', true);
    expect(seo.alternates).toEqual({ canonical: 'https://example.test/producto/x' });
    expect(seo.robots).toBeUndefined();
  });

  it('keeps ?pagina in a category canonical', () => {
    expect(pageSeo(ORIGIN, '/categoria/f?pagina=2', true).alternates?.canonical).toBe(
      'https://example.test/categoria/f?pagina=2',
    );
  });

  it('gives an indexable page without an origin no canonical and no robots', () => {
    const seo = pageSeo(null, '/producto/x', true);
    expect(seo.alternates).toBeUndefined();
    expect(seo.robots).toBeUndefined();
  });

  it.each([ORIGIN, null])(
    'marks a non-indexable page noindex and never gives it a canonical (origin %s)',
    (origin) => {
      const seo = pageSeo(origin, '/producto/x', false);
      expect(seo.robots).toEqual({ index: false });
      expect(seo.alternates).toBeUndefined();
    },
  );
});
