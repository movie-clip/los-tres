import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { ILLUSTRATION_KEYS } from '@/components/CategoryIllustration';
import { CategoryTiles, type CategoryTile } from '@/components/CategoryTiles';
import { HomeSearch, type HomeSearchProps } from '@/components/HomeSearch';

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

const search = (props: Partial<HomeSearchProps> = {}) =>
  renderToStaticMarkup(
    createElement(HomeSearch, { label: 'Buscar un producto', button: 'Buscar', notice: null, ...props }),
  );

describe('HomeSearch', () => {
  it('is a GET search form to / with an input named q', () => {
    const html = search();
    expect(html).toMatch(/<form [^>]*role="search"/);
    expect(html).toMatch(/<form [^>]*method="get"/);
    expect(html).toMatch(/<form [^>]*action="\/"/);
    expect(html).toMatch(/<input [^>]*name="q"/);
    expect(html).toMatch(/<input [^>]*type="search"/);
    expect(html).toMatch(/<button [^>]*type="submit"[^>]*>Buscar</);
  });

  it('ties the visible label to the input', () => {
    const html = search();
    const forId = html.match(/<label [^>]*for="([^"]+)"/)?.[1];
    expect(forId).toBeTruthy();
    expect(html).toMatch(new RegExp(`<input [^>]*id="${forId}"`));
    expect(html).toContain('>Buscar un producto<');
  });

  it('renders the input with no value and no placeholder, so a query is never echoed', () => {
    const html = search({ notice: 'Aviso' });
    const input = html.match(/<input [^>]*>/)?.[0] ?? '';
    expect(input).not.toMatch(/\svalue=/);
    expect(input).not.toMatch(/placeholder=/);
  });

  it('renders no notice when it is null', () => {
    expect(search()).not.toContain('home-search-notice');
    expect(search()).not.toContain('role="status"');
  });

  it('renders the notice as a status paragraph when given a string', () => {
    const html = search({ notice: 'Todavía no disponible.' });
    expect(html).toMatch(
      /<p [^>]*role="status"[^>]*data-testid="home-search-notice"[^>]*>Todavía no disponible\.</,
    );
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
