import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Breadcrumb } from '@/components/Breadcrumb';
import { OfferList } from '@/components/OfferList';
import { ProductDescription } from '@/components/ProductDescription';
import { ProductHero } from '@/components/ProductHero';
import { goPath } from '@/server/clicks/go-path';

// The two display components take finished strings only (C-12, C-13). These
// cover the branches the e2e cannot reach with the demo data.

function details(props: Partial<Parameters<typeof ProductHero>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(ProductHero, {
      title: 'Titulo de prueba',
      brand: null,
      imageLabel: 'Sin imagen',
      details: [],
      illustration: null,
      priceLabel: null,
      price: '10,49 €',
      shopCount: '1 tienda',
      vatNote: 'Con IVA',
      ...props,
    }),
  );
}

describe('ProductHero', () => {
  it('renders one h1 with the title and the labelled image placeholder', () => {
    const html = details();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('>Titulo de prueba</h1>');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Sin imagen"');
  });

  it('omits the dl entirely when no detail exists', () => {
    expect(details({ details: [] })).not.toContain('<dl');
  });

  it('renders a dt/dd pair for each detail present', () => {
    const html = details({
      details: [
        { label: 'Referencia', value: 'REF-1' },
        { label: 'EAN', value: '2000000000015' },
      ],
    });
    expect(html.match(/<dt\b/g)).toHaveLength(2);
    expect(html.match(/<dd\b/g)).toHaveLength(2);
    expect(html).toContain('>Referencia</dt>');
    expect(html).toContain('>2000000000015</dd>');
  });
});

describe('ProductHero price block (S11.5)', () => {
  it('shows the brand line when a brand exists and none when it is null', () => {
    const withBrand = details({ brand: 'MarcaDemo' });
    expect(withBrand).toMatch(/data-testid="product-brand"[^>]*>MarcaDemo</);
    expect(details({ brand: null })).not.toContain('product-brand');
  });

  it('shows the from-label only when given, before the price', () => {
    const withLabel = details({ priceLabel: 'Desde' });
    expect(withLabel).toContain('>Desde</span>');
    expect(withLabel.indexOf('Desde')).toBeLessThan(withLabel.indexOf('data-testid="product-price"'));
    expect(details({ priceLabel: null })).not.toContain('Desde');
  });

  it('renders the price, the shop count and the VAT note once each', () => {
    const html = details({ price: '10,49 €', shopCount: '4 tiendas', vatNote: 'Con IVA' });
    expect(html).toMatch(/data-testid="product-price"[^>]*>10,49 €</);
    expect(html).toMatch(/data-testid="shop-count"[^>]*>4 tiendas</);
    expect(html.match(/Con IVA/g)).toHaveLength(1);
  });
});

describe('Breadcrumb (S11.5)', () => {
  const items = [
    { name: 'Mantenimiento del coche', href: '/categoria/mantenimiento-del-coche' },
    { name: 'Filtros de aire', href: '/categoria/filtros-de-aire' },
  ];

  it('is a nav named by its label with one link per item, in order', () => {
    const html = renderToStaticMarkup(createElement(Breadcrumb, { label: 'Ruta de navegación', items }));
    expect(html).toMatch(/^<nav\b[^>]*aria-label="Ruta de navegación"/);
    expect(html).toContain('data-testid="breadcrumb"');
    const anchors = html.match(/<a\b[^>]*>[^<]*<\/a>/g) ?? [];
    expect(anchors).toHaveLength(2);
    items.forEach((item, index) => {
      expect(anchors[index]).toContain(`href="${item.href}"`);
      expect(anchors[index]).toContain(`>${item.name}</a>`);
    });
    expect(html.match(/<li\b/g)).toHaveLength(2);
  });

  it('puts no separator text in the DOM', () => {
    const html = renderToStaticMarkup(createElement(Breadcrumb, { label: 'Ruta', items }));
    const visible = html.replace(/<[^>]*>/g, '');
    expect(visible).toBe('Mantenimiento del cocheFiltros de aire');
  });

  it('renders nothing for an empty trail', () => {
    expect(renderToStaticMarkup(createElement(Breadcrumb, { label: 'Ruta', items: [] }))).toBe('');
  });
});

describe('ProductDescription', () => {
  it('renders the heading as h2 and the text in a paragraph in its own section', () => {
    const html = renderToStaticMarkup(
      createElement(ProductDescription, { heading: 'Descripción', text: 'Texto plano' }),
    );
    expect(html).toContain('data-testid="product-description"');
    expect(html).toContain('>Descripción</h2>');
    expect(html).toContain('>Texto plano</p>');
  });

  it('renders the description as text: markup in it is escaped, never HTML', () => {
    const html = renderToStaticMarkup(
      createElement(ProductDescription, {
        heading: 'Descripcion',
        text: '<script>alert(1)</script><b>negrita</b>',
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('OfferList', () => {
  const rows = [
    {
      key: '2',
      shopName: 'Tienda B',
      price: '11,49 €',
      updated: 'Actualizado hoy',
      goHref: goPath(2),
      goLabel: 'Ir a la tienda',
      goAccessibleName: 'Ir a la tienda de Tienda B',
      isBestPrice: true,
    },
    {
      key: '1',
      shopName: 'Tienda A',
      price: '12,99 €',
      updated: 'Actualizado hoy',
      goHref: goPath(1),
      goLabel: 'Ir a la tienda',
      goAccessibleName: 'Ir a la tienda de Tienda A',
      isBestPrice: false,
    },
  ];

  function list() {
    return renderToStaticMarkup(
      createElement(OfferList, {
        heading: 'Donde comprarlo',
        bestPriceLabel: 'Mejor precio',
        offers: rows,
      }),
    );
  }

  it('renders the rows in the order given, never sorting them', () => {
    const html = list();
    expect(html.indexOf('Tienda B')).toBeGreaterThan(-1);
    expect(html.indexOf('Tienda B')).toBeLessThan(html.indexOf('Tienda A'));
    expect(html.match(/data-testid="offer-row"/g)).toHaveLength(2);
  });

  it('shows the price of each row', () => {
    const html = list();
    expect(html).toContain('>11,49 €<');
  });

  it('renders one sponsored anchor per row to its given path and no button', () => {
    const html = list();
    const anchors = html.match(/<a\b[^>]*>[^<]*<\/a>/g) ?? [];
    expect(anchors).toHaveLength(rows.length);
    anchors.forEach((anchor, index) => {
      const row = rows[index];
      expect(anchor).toContain(`href="${row.goHref}"`);
      expect(anchor).toContain('data-testid="offer-go"');
      expect(anchor).toMatch(/rel="[^"]*\bsponsored\b[^"]*"/);
      expect(anchor).toMatch(/rel="[^"]*\bnofollow\b[^"]*"/);
      expect(anchor).not.toMatch(/\btarget=/);
      expect(anchor).not.toMatch(/noreferrer|noopener|referrerpolicy/i);
      expect(anchor).toContain(`>${row.goLabel}</a>`);
    });
    expect(html).not.toMatch(/<button\b/);
    expect(html.match(/href=/g)).toHaveLength(rows.length);
  });

  it('tags only the rows flagged best price, with the given label, and never computes it', () => {
    const html = list();
    expect(html.match(/data-testid="best-price"/g)).toHaveLength(1);
    const [first, second] = html.split('data-testid="offer-row"').slice(1);
    expect(first).toMatch(/data-testid="best-price"[^>]*>Mejor precio</);
    expect(second).not.toContain('best-price');

    // Prices that would make the second row cheaper do not move the tag.
    const swapped = renderToStaticMarkup(
      createElement(OfferList, {
        heading: 'h',
        bestPriceLabel: 'Mejor precio',
        offers: rows.map((row) => ({ ...row, isBestPrice: false })),
      }),
    );
    expect(swapped).not.toContain('best-price');
  });

  it('tags every tied row when several are flagged', () => {
    const html = renderToStaticMarkup(
      createElement(OfferList, {
        heading: 'h',
        bestPriceLabel: 'Mejor precio',
        offers: rows.map((row) => ({ ...row, isBestPrice: true })),
      }),
    );
    expect(html.match(/data-testid="best-price"/g)).toHaveLength(2);
  });

  it('carries no shop count and no VAT note of its own', () => {
    const html = list();
    expect(html).not.toContain('shop-count');
    expect(html).not.toMatch(/IVA/);
  });

  it('shows the short visible label and puts the shop in the accessible name', () => {
    const html = list();
    const anchors = html.match(/<a\b[^>]*>[^<]*<\/a>/g) ?? [];
    anchors.forEach((anchor, index) => {
      expect(anchor).toContain(`aria-label="${rows[index].goAccessibleName}"`);
      expect(anchor).toContain('>Ir a la tienda</a>');
      expect(anchor.replace(/aria-label="[^"]*"/, '')).not.toContain(rows[index].shopName);
    });
  });

  it('shows the updated line of each row', () => {
    const html = list();
    expect(html.match(/data-testid="offer-updated"[^>]*>Actualizado hoy</g)).toHaveLength(2);
  });

  it('renders an empty list without throwing', () => {
    const html = renderToStaticMarkup(
      createElement(OfferList, { heading: 'h', bestPriceLabel: 'b', offers: [] }),
    );
    expect(html).not.toContain('data-testid="offer-row"');
  });
});

describe('ImagePlaceholder via ProductHero (S11.2)', () => {
  it('keeps role="img" and the label, and draws nothing when there is no illustration', () => {
    const html = details({ illustration: null });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Sin imagen"');
    expect(html).not.toContain('<svg');
  });

  it('keeps role="img" and the label around the drawing when there is one', () => {
    const html = details({ illustration: 'filtros-de-habitaculo', imageLabel: 'Ilustración de prueba' });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Ilustración de prueba"');
    expect(html.match(/<svg\b/g)).toHaveLength(1);
  });
});
