import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OfferList } from '@/components/OfferList';
import { ProductDetails } from '@/components/ProductDetails';
import { goPath } from '@/server/clicks/go-path';

// The two display components take finished strings only (C-12, C-13). These
// cover the branches the e2e cannot reach with the demo data.

function details(props: Partial<Parameters<typeof ProductDetails>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(ProductDetails, {
      title: 'Titulo de prueba',
      imageLabel: 'Sin imagen',
      details: [],
      description: null,
      illustration: null,
      ...props,
    }),
  );
}

describe('ProductDetails', () => {
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
        { label: 'Marca', value: 'MarcaX' },
        { label: 'EAN', value: '2000000000015' },
      ],
    });
    expect(html.match(/<dt\b/g)).toHaveLength(2);
    expect(html.match(/<dd\b/g)).toHaveLength(2);
    expect(html).toContain('>Marca</dt>');
    expect(html).toContain('>2000000000015</dd>');
  });

  it('omits the description paragraph when the description is null', () => {
    expect(details({ description: null })).not.toContain('<p');
  });

  it('renders the description as text: markup in it is escaped, never HTML', () => {
    const html = details({ description: '<script>alert(1)</script><b>negrita</b>' });
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
      goLabel: 'Ir a la tienda de Tienda B',
    },
    {
      key: '1',
      shopName: 'Tienda A',
      price: '12,99 €',
      updated: 'Actualizado hoy',
      goHref: goPath(1),
      goLabel: 'Ir a la tienda de Tienda A',
    },
  ];

  function list() {
    return renderToStaticMarkup(
      createElement(OfferList, {
        heading: 'Donde comprarlo',
        shopCount: '2 tiendas',
        vatNote: 'Con IVA',
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

  it('shows the count, the IVA note and the price of each row', () => {
    const html = list();
    expect(html).toContain('data-testid="shop-count">2 tiendas<');
    expect(html).toContain('Con IVA');
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

  it('renders an empty list without throwing', () => {
    const html = renderToStaticMarkup(
      createElement(OfferList, { heading: 'h', shopCount: '0 tiendas', vatNote: 'n', offers: [] }),
    );
    expect(html).not.toContain('data-testid="offer-row"');
  });
});

describe('ImagePlaceholder via ProductDetails (S11.2)', () => {
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
