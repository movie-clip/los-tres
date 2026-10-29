import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { ILLUSTRATION_KEYS } from '@/components/CategoryIllustration';
import { CategoryTiles, type CategoryTile } from '@/components/CategoryTiles';
import { SearchForm, type SearchFormProps } from '@/components/SearchForm';

// The home components take finished strings and hrefs only. These cover the
// states the demo data cannot reach: five tiles, one tile, no tile.

const tile = (n: number, overrides: Partial<CategoryTile> = {}): CategoryTile => ({
  key: `categoria-${n}`,
  href: `/categoria/categoria-${n}`,
  name: `Nombre ${n}`,
  count: n === 1 ? '1 producto' : `${n} productos`,
  illustration: ILLUSTRATION_KEYS[(n - 1) % ILLUSTRATION_KEYS.length],
  ...overrides,
});

const five = [1, 2, 3, 4, 5].map((n) => tile(n));

const renderTiles = (tiles: CategoryTile[]) =>
  renderToStaticMarkup(createElement(CategoryTiles, { tiles }));

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('CategoryTiles', () => {
  it('renders five tiles, one link each, in the order given', () => {
    const html = renderTiles(five);
    expect(html).toContain('data-testid="category-tiles"');
    expect(count(html, 'data-testid="category-tile"')).toBe(5);
    expect(count(html, 'data-testid="category-tile-link"')).toBe(5);
    expect(count(html, '<ul')).toBe(1);
    const positions = five.map((t) => html.indexOf(t.name));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it('keeps the given order and never sorts', () => {
    const html = renderTiles([five[3], five[0]]);
    expect(html.indexOf('Nombre 4')).toBeLessThan(html.indexOf('Nombre 1'));
  });

  it('renders one tile', () => {
    const html = renderTiles([tile(1)]);
    expect(count(html, 'data-testid="category-tile"')).toBe(1);
    expect(count(html, '<ul')).toBe(1);
    expect(html).toContain('data-testid="category-tile-count">1 producto<');
  });

  it('renders nothing for an empty list', () => {
    const html = renderTiles([]);
    expect(html).toBe('');
    expect(html).not.toContain('<ul');
  });

  it('links each tile to its href with the finished name and count inside the link', () => {
    const html = renderTiles(five);
    expect(html).toMatch(
      /<a [^>]*href="\/categoria\/categoria-3"[^>]*data-testid="category-tile-link"/,
    );
    expect(html).toContain('data-testid="category-tile-name">Nombre 3<');
    expect(html).toContain('data-testid="category-tile-count">3 productos<');
  });

  it('puts the count in the last span of the link', () => {
    const html = renderTiles([tile(2)]);
    const link = html.slice(html.indexOf('<a '), html.indexOf('</a>'));
    const lastSpan = link.slice(link.lastIndexOf('<span'));
    expect(lastSpan).toContain('data-testid="category-tile-count"');
  });

  it('draws each illustration inside an aria-hidden box', () => {
    const html = renderTiles(five);
    expect(count(html, 'data-testid="category-illustration"')).toBe(5);
    const art = html.match(/<span [^>]*aria-hidden="true"[^>]*>/g) ?? [];
    expect(art.length).toBeGreaterThanOrEqual(5);
    expect(html).toMatch(/aria-hidden="true"[^>]*>(<svg|<img)/);
  });

  it('still renders a tile when its illustration is null, with an empty box', () => {
    const html = renderTiles([tile(1, { illustration: null })]);
    expect(count(html, 'data-testid="category-tile"')).toBe(1);
    expect(html).not.toContain('data-testid="category-illustration"');
    expect(html).toContain('Nombre 1');
  });
});

const search = (props: Partial<SearchFormProps> = {}) =>
  renderToStaticMarkup(
    createElement(SearchForm, {
      variant: 'hero',
      action: '/buscar',
      formLabel: 'Buscar',
      fieldLabel: 'Buscar un producto',
      button: 'Buscar',
      hint: 'Por nombre, referencia o EAN',
      value: null,
      ...props,
    }),
  );

describe('SearchForm, hero presentation (the home form)', () => {
  it('is a GET search form to /buscar with an input named q', () => {
    const html = search();
    expect(html).toMatch(/<form [^>]*role="search"/);
    expect(html).toMatch(/<form [^>]*method="get"/);
    expect(html).toMatch(/<form [^>]*action="\/buscar"/);
    expect(html).toMatch(/<form [^>]*data-testid="home-search"/);
    expect(html).toMatch(/<input [^>]*name="q"/);
    expect(html).toMatch(/<input [^>]*type="search"/);
    expect(html).toMatch(/<input [^>]*maxLength="100"/i);
    expect(html).toMatch(/<button [^>]*type="submit"[^>]*>Buscar</);
  });

  it('ties the visible label to the input', () => {
    const html = search();
    const forId = html.match(/<label [^>]*for="([^"]+)"/)?.[1];
    expect(forId).toBeTruthy();
    expect(html).toMatch(new RegExp(`<input [^>]*id="${forId}"`));
    expect(html).toContain('>Buscar un producto<');
  });

  it('renders the input with no value and no placeholder, so a typed query is never echoed', () => {
    const html = search({ value: 'filtro' });
    const input = html.match(/<input [^>]*>/)?.[0] ?? '';
    expect(input).not.toMatch(/\svalue=/);
    expect(input).not.toMatch(/placeholder=/);
  });

  it('renders the hint and ties it to the input, and renders no status note', () => {
    const html = search();
    const describedBy = html.match(/<input [^>]*aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toMatch(new RegExp(`<p [^>]*id="${describedBy}"[^>]*>Por nombre, referencia o EAN<`));
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('home-search-notice');
  });
});

describe('SearchForm, page and header presentations', () => {
  it('echoes the cleaned term in the page presentation only', () => {
    const page = search({ variant: 'page', value: 'filtro de aceite' });
    expect(page).toMatch(/<input [^>]*value="filtro de aceite"/);
    expect(page).toMatch(/<form [^>]*data-testid="search-form"/);
    expect(search({ variant: 'header', value: 'filtro', hint: null })).not.toMatch(/<input [^>]*value=/);
  });

  it('gives the header field an accessible name and no visible label or hint', () => {
    const html = search({ variant: 'header', hint: null });
    expect(html).not.toContain('<label');
    expect(html).toMatch(/<input [^>]*aria-label="Buscar un producto"/);
    expect(html).not.toContain('aria-describedby');
    expect(html).toMatch(/<form [^>]*data-testid="header-search"/);
  });

  it('keeps ids per presentation so two forms can share one document', () => {
    const ids = (html: string) => html.match(/<input [^>]*id="([^"]+)"/)?.[1];
    expect(new Set(['hero', 'page', 'header'].map((variant) => ids(search({ variant: variant as SearchFormProps['variant'] }))))).toHaveProperty('size', 3);
  });

  it('marks the forms that own the page search, and not the header form', () => {
    expect(search({ variant: 'hero' })).toContain('data-search-page');
    expect(search({ variant: 'page' })).toContain('data-search-page');
    expect(search({ variant: 'header', hint: null })).not.toContain('data-search-page');
  });
});

describe('CategoryEmpty on the home page', () => {
  it('renders the heading and body and no link when homeLabel is omitted', () => {
    const html = renderToStaticMarkup(
      createElement(CategoryEmpty, { heading: 'Estamos preparando', body: 'Vuelve pronto.' }),
    );
    expect(html).toContain('data-testid="category-empty"');
    expect(html).toContain('Estamos preparando');
    expect(html).toContain('Vuelve pronto.');
    expect(html).not.toContain('<a');
  });

  it('still renders the link when homeLabel is given', () => {
    const html = renderToStaticMarkup(
      createElement(CategoryEmpty, { heading: 'h', body: 'b', homeLabel: 'Volver' }),
    );
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Volver</);
  });
});
