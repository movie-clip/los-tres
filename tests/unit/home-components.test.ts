import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { CategoryTree, type CategoryTreeProps } from '@/components/CategoryTree';

// The home components take finished strings and hrefs only (S5.2). These cover
// the branches the demo data cannot reach in one e2e page.

const groups: CategoryTreeProps['groups'] = [
  {
    key: 'automovil',
    href: '/categoria/automovil',
    name: 'Automóvil',
    count: '27 productos',
    children: [
      { key: 'filtros', href: '/categoria/filtros', name: 'Filtros', count: '26 productos' },
      { key: 'bombillas', href: '/categoria/bombillas', name: 'Bombillas', count: '1 producto' },
    ],
  },
  { key: 'solo', href: '/categoria/solo', name: 'Solo cabecera', count: '2 productos', children: [] },
];

const render = (g: CategoryTreeProps['groups'] = groups) =>
  renderToStaticMarkup(createElement(CategoryTree, { groups: g }));

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('CategoryTree', () => {
  it('renders one group per entry and one row per child under their testids', () => {
    const html = render();
    expect(html).toContain('data-testid="category-tree"');
    expect(count(html, 'data-testid="category-group"')).toBe(2);
    expect(count(html, 'data-testid="category-row"')).toBe(2);
    expect(count(html, 'data-testid="category-group-link"')).toBe(2);
    expect(count(html, 'data-testid="category-row-link"')).toBe(2);
  });

  it('links each node to its href and puts the name and finished count in the link', () => {
    const html = render();
    expect(html).toMatch(/<a [^>]*href="\/categoria\/automovil"[^>]*data-testid="category-group-link"/);
    expect(html).toMatch(/<a [^>]*href="\/categoria\/filtros"[^>]*data-testid="category-row-link"/);
    expect(html).toContain('data-testid="category-group-count">27 productos<');
    expect(html).toContain('data-testid="category-row-count">1 producto<');
    expect(html).toContain('>Filtros<');
  });

  it('renders the groups in the order given', () => {
    const html = render([groups[1], groups[0]]);
    expect(html.indexOf('Solo cabecera')).toBeLessThan(html.indexOf('Automóvil'));
  });

  it('renders a heading-only group with no nested list', () => {
    const html = render([groups[1]]);
    expect(html).toContain('data-testid="category-group"');
    expect(html).not.toContain('category-row');
    // Only the outer groups list exists.
    expect(count(html, '<ul')).toBe(1);
  });

  it('renders a nested list only for the group that has children', () => {
    expect(count(render(), '<ul')).toBe(2);
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
