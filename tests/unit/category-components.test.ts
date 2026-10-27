import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { Pagination } from '@/components/Pagination';
import { ProductCard, type ProductCardProps } from '@/components/ProductCard';
import { ProductGrid } from '@/components/ProductGrid';

// The listing components take finished strings and hrefs only (C-5). These
// cover the branches the e2e cannot reach with one page of demo data.

const card: ProductCardProps = {
  href: '/producto/uno',
  title: 'Filtro de aceite',
  brand: 'MarcaX',
  priceFrom: 'Desde',
  price: '11,49 €',
  shopCount: '2 tiendas',
  illustration: null,
};

const render = (props: Partial<ProductCardProps> = {}) =>
  renderToStaticMarkup(createElement(ProductCard, { ...card, ...props }));

describe('ProductCard', () => {
  it('renders title, brand, "from" label, price and shop count under their testids', () => {
    const html = render();
    expect(html).toContain('data-testid="category-card"');
    expect(html).toMatch(/data-testid="card-title"[^>]*>Filtro de aceite</);
    expect(html).toContain('data-testid="card-brand">MarcaX<');
    expect(html).toContain('data-testid="card-price-from">Desde<');
    expect(html).toContain('data-testid="card-price">11,49 €<');
    expect(html).toContain('data-testid="card-shop-count">2 tiendas<');
  });

  it('renders no brand element, and no placeholder text, when the brand is null', () => {
    const html = render({ brand: null });
    expect(html).not.toContain('card-brand');
    expect(html).not.toMatch(/null|undefined/);
  });

  it('renders no "from" label when the product has one shop', () => {
    const html = render({ priceFrom: null, shopCount: '1 tienda' });
    expect(html).not.toContain('card-price-from');
    expect(html).toContain('data-testid="card-shop-count">1 tienda<');
    expect(html).toContain('data-testid="card-price"');
  });

  it('holds exactly one anchor, to the product page, and never a /go link', () => {
    const html = render();
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).toContain('href="/producto/uno"');
    expect(html).not.toContain('/go/');
    expect(html).not.toMatch(/<button\b/);
  });

  it('never puts the title or the price in a paragraph (the .page p rule would mute them)', () => {
    const html = render();
    expect(html).not.toMatch(/<p\b/);
    expect(html).toMatch(/<h2\b[^>]*>.*Filtro de aceite.*<\/h2>/);
  });

  it('escapes markup in the title as text', () => {
    const html = render({ title: '<script>x()</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('ProductGrid', () => {
  it('renders the cards in the order given, never sorting them', () => {
    const html = renderToStaticMarkup(
      createElement(ProductGrid, {
        cards: [
          { ...card, key: 'b', title: 'Segundo' },
          { ...card, key: 'a', title: 'Primero' },
        ],
      }),
    );
    expect(html.match(/data-testid="category-card"/g)).toHaveLength(2);
    expect(html.indexOf('Segundo')).toBeLessThan(html.indexOf('Primero'));
    expect(html).toMatch(/^<ul\b/);
  });
});

describe('Pagination', () => {
  const nav = (props: { previous: boolean; next: boolean }) =>
    renderToStaticMarkup(
      createElement(Pagination, {
        navLabel: 'Paginación',
        indicator: 'Página 2 de 3',
        previous: props.previous ? { href: '/categoria/x', label: 'Anterior' } : null,
        next: props.next ? { href: '/categoria/x?pagina=3', label: 'Siguiente' } : null,
      }),
    );

  it('renders both links, the indicator and an accessible nav name in the middle of the list', () => {
    const html = nav({ previous: true, next: true });
    expect(html).toContain('aria-label="Paginación"');
    expect(html).toContain('data-testid="pagination-indicator">Página 2 de 3<');
    expect(html).toContain('href="/categoria/x"');
    expect(html).toContain('href="/categoria/x?pagina=3"');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
  });

  it('renders no previous link on the first page', () => {
    const html = nav({ previous: false, next: true });
    expect(html).not.toContain('pagination-prev');
    expect(html).toContain('pagination-next');
  });

  it('renders no next link on the last page', () => {
    const html = nav({ previous: true, next: false });
    expect(html).not.toContain('pagination-next');
    expect(html).toContain('pagination-prev');
  });

  it('uses plain anchors: no button and no script', () => {
    const html = nav({ previous: true, next: true });
    expect(html).not.toMatch(/<button\b|<script\b/);
  });
});

describe('CategoryEmpty', () => {
  const html = renderToStaticMarkup(
    createElement(CategoryEmpty, { heading: 'Aún no hay', body: 'Vuelve pronto.', homeLabel: 'Volver' }),
  );

  it('renders the heading, the body and a link home', () => {
    expect(html).toContain('data-testid="category-empty"');
    expect(html).toContain('>Aún no hay</h2>');
    expect(html).toContain('Vuelve pronto.');
    expect(html).toMatch(/<a\b[^>]*href="\/"[^>]*>Volver<\/a>/);
  });

  it('renders no card, grid or pagination', () => {
    expect(html).not.toMatch(/category-card|<ul\b|pagination/);
  });
});

describe('ProductCard tile (S11.2)', () => {
  it.each([null, 'filtros-de-aire' as const])('renders an aria-hidden card-tile for illustration %s', (illustration) => {
    const html = render({ illustration });
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*data-testid="card-tile"|<span[^>]*data-testid="card-tile"[^>]*aria-hidden="true"/);
    expect(html.match(/data-testid="card-tile"/g)).toHaveLength(1);
  });

  it('draws the illustration inside the tile only when one is given', () => {
    expect(render({ illustration: null })).not.toContain('<svg');
    expect(render({ illustration: 'aceite-de-motor' })).toContain('data-testid="category-illustration"');
  });

  it('keeps the title as the one link of the card, with or without an illustration', () => {
    for (const illustration of [null, 'filtros-de-aceite' as const]) {
      expect(render({ illustration }).match(/<a\b/g)).toHaveLength(1);
    }
  });
});
