import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { SearchForm, type SearchFormProps } from '@/components/SearchForm';
import { SiteHeader } from '@/components/SiteHeader';

// S5.7 T5.7.5 (AC 43, 44, 46, 47): the shared components receive finished car values and draw
// them as plain anchors and one hidden `coche` field. They never import withCar themselves.

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => `t:${key}`,
}));

const SLUG = 'seat-leon-iii-2012-2020-1-6-tdi-105cv';
const VARIANTS: SearchFormProps['variant'][] = ['hero', 'page', 'header'];

const search = (props: Partial<SearchFormProps> = {}) =>
  renderToStaticMarkup(
    createElement(SearchForm, {
      variant: 'hero',
      action: '/buscar',
      formLabel: 'Buscar',
      fieldLabel: 'Buscar un producto',
      button: 'Buscar',
      hint: null,
      value: null,
      ...props,
    }),
  );

const hiddenInputs = (html: string) => html.match(/<input\b[^>]*type="hidden"[^>]*>/g) ?? [];

describe('SearchForm car field (S5.7, AC 44, 46)', () => {
  it.each(VARIANTS)('renders exactly one hidden coche input with the slug in the %s variant', (variant) => {
    const hidden = hiddenInputs(search({ variant, car: SLUG }));
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toMatch(/name="coche"/);
    expect(hidden[0]).toContain(`value="${SLUG}"`);
  });

  it.each(VARIANTS)('renders no hidden input when car is null in the %s variant', (variant) => {
    expect(hiddenInputs(search({ variant, car: null }))).toHaveLength(0);
    expect(search({ variant, car: null })).not.toContain('coche');
  });

  it.each(VARIANTS)('renders no hidden input when car is omitted in the %s variant', (variant) => {
    expect(search({ variant })).not.toContain('coche');
  });

  it('escapes the slug', () => {
    const html = search({ car: '"><script>x()</script>' });
    expect(html).not.toContain('<script>');
    expect(hiddenInputs(html)).toHaveLength(1);
  });

  it('keeps the car field out of the visible term field', () => {
    const html = search({ variant: 'page', value: 'filtro', car: SLUG });
    expect(html.match(/name="q"/g)).toHaveLength(1);
    expect(html.match(/name="coche"/g)).toHaveLength(1);
  });
});

describe('home links as plain anchors (S5.7, AC 43, 46)', () => {
  const header = (homeHref?: string) =>
    renderToStaticMarkup(
      createElement(SiteHeader, { siteName: 'Sitio', search: null, ...(homeHref === undefined ? {} : { homeHref }) }),
    );
  const empty = (homeHref?: string) =>
    renderToStaticMarkup(
      createElement(CategoryEmpty, {
        heading: 'h',
        body: 'b',
        homeLabel: 'Volver',
        ...(homeHref === undefined ? {} : { homeHref }),
      }),
    );

  it('SiteHeader: the site name links to homeHref, "/" when omitted', () => {
    expect(header(`/?coche=${SLUG}`)).toMatch(
      new RegExp(`<a [^>]*data-testid="site-header-link"[^>]*href="/\\?coche=${SLUG}"[^>]*>Sitio</a>`),
    );
    expect(header()).toMatch(/<a [^>]*data-testid="site-header-link"[^>]*href="\/"[^>]*>Sitio</);
    expect(header()).not.toContain('coche');
  });

  it('CategoryEmpty: the home link is homeHref, "/" when omitted', () => {
    expect(empty(`/?coche=${SLUG}`)).toMatch(new RegExp(`<a\\b[^>]*href="/\\?coche=${SLUG}"[^>]*>Volver</a>`));
    expect(empty()).toMatch(/<a\b[^>]*href="\/"[^>]*>Volver<\/a>/);
    expect(empty()).not.toContain('coche');
  });

  it('NotFoundContent: the home link is homeHref, "/" when omitted', async () => {
    const { NotFoundContent } = await import('@/components/NotFoundContent');
    const withCar = renderToStaticMarkup(await NotFoundContent({ homeHref: `/?coche=${SLUG}` }));
    expect(withCar).toMatch(new RegExp(`<a\\b[^>]*href="/\\?coche=${SLUG}"[^>]*>t:backHome</a>`));
    const none = renderToStaticMarkup(await NotFoundContent({}));
    expect(none).toMatch(/<a\b[^>]*href="\/"[^>]*>t:backHome<\/a>/);
    expect(none).not.toContain('coche');
  });

  it('none of the four components imports next/link', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['SiteHeader', 'CategoryEmpty', 'NotFoundContent', 'SearchForm']) {
      const source = readFileSync(`src/components/${file}.tsx`, 'utf8');
      expect(source, file).not.toMatch(/from ['"]next\/link['"]/);
    }
  });

  // M2 (#339): next/link prefetches its target on view, hover and focus, so a /go link drawn with it
  // would load the redirect before any click. OfferList draws the /go links as plain anchors.
  it('OfferList imports no next/link, so no /go link can be prefetched', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/components/OfferList.tsx', 'utf8');
    expect(source).not.toMatch(/from ['"]next\/link['"]/);
    expect(source).not.toMatch(/require\(['"]next\/link['"]\)/);
  });
});
