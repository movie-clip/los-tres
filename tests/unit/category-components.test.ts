import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BrandChips, VISIBLE_BRAND_CHIPS, type BrandChip } from '@/components/BrandChips';
import { CategoryEmpty } from '@/components/CategoryEmpty';
import { CategoryResultsPanel } from '@/components/CategoryResultsPanel';
import { CategorySort } from '@/components/CategorySort';
import { Pagination } from '@/components/Pagination';
import { ProductCard, type ProductCardProps } from '@/components/ProductCard';
import { ProductGrid } from '@/components/ProductGrid';

// The listing components take finished strings and hrefs only (C-5). These
// cover the branches the e2e cannot reach with one page of demo data.

const card: ProductCardProps = {
  href: '/producto/uno',
  title: 'Filtro de aceite',
  brand: 'MarcaX',
  spec: null,
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

describe('ProductCard spec line (S11.4)', () => {
  it('renders the spec line after the title when there is one', () => {
    const html = render({ spec: 'Ref. OC-1234' });
    expect(html).toContain('data-testid="card-spec">Ref. OC-1234<');
    expect(html.indexOf('card-title')).toBeLessThan(html.indexOf('card-spec'));
  });

  it('renders no spec element, no empty line and no placeholder text when it is null', () => {
    const html = render({ spec: null });
    expect(html).not.toContain('card-spec');
    expect(html).not.toMatch(/null|undefined/);
  });

  it('reads brand, title, spec, price in that order', () => {
    const html = render({ spec: 'Ref. X' });
    expect(html.indexOf('card-brand')).toBeLessThan(html.indexOf('card-title'));
    expect(html.indexOf('card-title')).toBeLessThan(html.indexOf('card-spec'));
    expect(html.indexOf('card-spec')).toBeLessThan(html.indexOf('data-testid="card-price"'));
  });

  it('escapes markup in the spec as text', () => {
    const html = render({ spec: '<img src=x>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('CategoryEmpty action (S11.4)', () => {
  const withAction = renderToStaticMarkup(
    createElement(CategoryEmpty, {
      heading: 'Sin marca',
      body: 'Prueba otra.',
      action: { href: '/categoria/x', label: 'Quitar el filtro' },
    }),
  );

  it('renders the action as a plain anchor to the given path', () => {
    expect(withAction).toMatch(
      /<a\b[^>]*href="\/categoria\/x"[^>]*data-testid="category-empty-action"[^>]*>Quitar el filtro<\/a>/,
    );
    expect(withAction).not.toMatch(/<button\b/);
  });

  it('renders no home link when homeLabel is omitted', () => {
    expect(withAction).not.toContain('href="/"');
  });

  it('renders no action element when none is given', () => {
    const html = renderToStaticMarkup(
      createElement(CategoryEmpty, { heading: 'a', body: 'b', homeLabel: 'Volver' }),
    );
    expect(html).not.toContain('category-empty-action');
  });

  it('can carry the action and the home link together', () => {
    const html = renderToStaticMarkup(
      createElement(CategoryEmpty, {
        heading: 'a',
        body: 'b',
        homeLabel: 'Volver',
        action: { href: '/categoria/x', label: 'Quitar' },
      }),
    );
    expect(html).toContain('category-empty-action');
    expect(html).toMatch(/<a\b[^>]*href="\/"[^>]*>Volver<\/a>/);
  });
});

describe('BrandChips (S11.4)', () => {
  const chip = (n: number, selected = false): BrandChip => ({
    key: `m${n}`,
    href: `/categoria/x?marca=m${n}`,
    label: `Marca ${n}`,
    count: String(n),
    ariaLabel: `Marca ${n}: ${n} productos`,
    selected,
  });
  const render = (props: { chips: BrandChip[]; more?: BrandChip[]; allSelected?: boolean }) =>
    renderToStaticMarkup(
      createElement(BrandChips, {
        groupLabel: 'Marca',
        all: { href: '/categoria/x', label: 'Todas las marcas', selected: props.allSelected ?? true },
        chips: props.chips,
        moreChips: props.more ?? [],
        moreLabel: `Más marcas (${(props.more ?? []).length})`,
      }),
    );

  it('keeps 8 chips in the row before the overflow', () => {
    expect(VISIBLE_BRAND_CHIPS).toBe(8);
  });

  it('labels the list by the visible group label', () => {
    const html = render({ chips: [chip(1), chip(2)] });
    const id = /<span id="([^"]+)"[^>]*>Marca<\/span>/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`aria-labelledby="${id}"`);
  });

  it('puts "all brands" first, as a link', () => {
    const html = render({ chips: [chip(1), chip(2)] });
    expect(html.indexOf('brand-chip-all')).toBeLessThan(html.indexOf('data-testid="brand-chip"'));
    expect(html).toMatch(/<a\b[^>]*href="\/categoria\/x"[^>]*data-testid="brand-chip-all"/);
  });

  it('marks exactly the selected chip with aria-current', () => {
    const html = render({ chips: [chip(1), chip(2, true), chip(3)], allSelected: false });
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    const selected = /<a\b[^>]*aria-current="true"[^>]*>/.exec(html)?.[0] ?? '';
    expect(selected).toContain('href="/categoria/x?marca=m2"');
    expect(selected).toContain('aria-label="Marca 2: 2 productos"');
  });

  it('marks "all brands" and no other chip when no brand is selected', () => {
    const html = render({ chips: [chip(1), chip(2)] });
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(/<a\b[^>]*aria-current="true"[^>]*>/.exec(html)?.[0]).toContain('brand-chip-all');
  });

  it('marks no chip at all when none is selected, "all brands" included', () => {
    expect(render({ chips: [chip(1), chip(2)], allSelected: false })).not.toContain('aria-current');
  });

  it('renders no overflow control without overflow chips', () => {
    expect(render({ chips: [chip(1), chip(2)] })).not.toMatch(/<details|brand-more/);
  });

  it('renders the overflow in a closed native details when no chip in it is selected', () => {
    const html = render({ chips: [chip(1)], more: [chip(2), chip(3)] });
    expect(html).toContain('data-testid="brand-more"');
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain('Más marcas (2)');
    expect(html.match(/data-testid="brand-chip"/g)).toHaveLength(3);
  });

  it('opens the overflow when the selected chip is inside it', () => {
    const html = render({ chips: [chip(1)], more: [chip(2), chip(3, true)], allSelected: false });
    expect(html).toMatch(/<details[^>]*\bopen\b/);
  });

  it('renders links only: no button, no script, no form', () => {
    const html = render({ chips: [chip(1), chip(2, true)], more: [chip(3)] });
    expect(html).not.toMatch(/<button\b|<script\b|<form\b/);
  });

  it('shows the name and the count, and keeps the full name in aria-label', () => {
    const html = render({ chips: [chip(7)] });
    expect(html).toContain('>Marca 7</span>');
    expect(html).toContain('>7</span>');
    expect(html).toContain('aria-label="Marca 7: 7 productos"');
  });

  it('escapes a brand label as text', () => {
    const html = render({ chips: [{ ...chip(1), label: '<b>x</b>' }] });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('CategorySort (S11.4)', () => {
  const options = [
    { value: 'precio-asc', label: 'Precio: de menor a mayor' },
    { value: 'precio-desc', label: 'Precio: de mayor a menor' },
    { value: 'nombre', label: 'Nombre: de la A a la Z' },
  ];
  const render = (props: { selected?: string; hidden?: { name: string; value: string } | null } = {}) =>
    renderToStaticMarkup(
      createElement(CategorySort, {
        action: '/categoria/x',
        label: 'Ordenar por',
        submitLabel: 'Ordenar',
        name: 'orden',
        options,
        selected: props.selected ?? 'precio-asc',
        hidden: props.hidden ?? null,
      }),
    );

  it('is a GET form to the given path with a submit button, so it needs no script', () => {
    const html = render();
    expect(html).toMatch(/<form\b[^>]*action="\/categoria\/x"/);
    expect(html).toMatch(/<form\b[^>]*method="get"/i);
    expect(html).toMatch(/<button\b[^>]*type="submit"[^>]*>Ordenar<\/button>/);
    expect(html).not.toMatch(/<script\b|onchange/i);
  });

  it('labels the select and names it by the query parameter', () => {
    const html = render();
    const id = /<select\b[^>]*\bid="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`for="${id}"`);
    expect(html).toMatch(/<label\b[^>]*>Ordenar por<\/label>/);
    expect(html).toMatch(/<select\b[^>]*name="orden"/);
  });

  it('lists the options in the order given, with the public values', () => {
    const values = [...render().matchAll(/<option\b[^>]*value="([^"]+)"/g)].map((match) => match[1]);
    expect(values).toEqual(['precio-asc', 'precio-desc', 'nombre']);
  });

  it.each(['precio-asc', 'precio-desc', 'nombre'])('selects only the %s option', (selected) => {
    const tags = [...render({ selected }).matchAll(/<option\b[^>]*>/g)].map((match) => match[0]);
    const chosen = tags.filter((tag) => /selected/.test(tag));
    expect(chosen).toHaveLength(1);
    expect(chosen[0]).toContain(`value="${selected}"`);
  });

  it('adds no hidden field when none is given, and never a pagina field', () => {
    const html = render();
    expect(html).not.toContain('type="hidden"');
    expect(html).not.toContain('pagina');
  });

  it('carries the selected brand in a hidden field', () => {
    const html = render({ hidden: { name: 'marca', value: 'bosch' } });
    expect(html).toMatch(/<input\b[^>]*type="hidden"/);
    expect(html).toMatch(/name="marca"/);
    expect(html).toMatch(/value="bosch"/);
    expect(html.match(/type="hidden"/g)).toHaveLength(1);
  });

  it('escapes the value of the hidden field', () => {
    const html = render({ hidden: { name: 'marca', value: '"><script>x()</script>' } });
    expect(html).not.toContain('<script>');
  });
});

describe('CategoryResultsPanel (S11.4)', () => {
  const slot = (id: string) => createElement('div', { 'data-testid': id }, id);
  const panel = (o: { brands?: boolean; sort?: boolean }) =>
    renderToStaticMarkup(
      createElement(CategoryResultsPanel, {
        brands: o.brands === false ? null : slot('slot-brands'),
        count: '12 productos',
        sort: o.sort === false ? null : slot('slot-sort'),
      }),
    );

  it('renders the count under category-summary inside the panel', () => {
    const html = panel({});
    expect(html).toContain('data-testid="category-panel"');
    expect(html).toContain('data-testid="category-summary">12 productos<');
  });

  it('puts the brand slot before the count, and the sort slot after it', () => {
    const html = panel({});
    expect(html.indexOf('slot-brands')).toBeLessThan(html.indexOf('category-summary'));
    expect(html.indexOf('category-summary')).toBeLessThan(html.indexOf('slot-sort'));
  });

  it('renders no brand slot when brands is null, and the count stays', () => {
    const html = panel({ brands: false });
    expect(html).not.toContain('slot-brands');
    expect(html).toContain('category-summary');
  });

  it('renders no sort slot when sort is null, and the count stays', () => {
    const html = panel({ sort: false });
    expect(html).not.toContain('slot-sort');
    expect(html).toContain('category-summary');
  });
});
