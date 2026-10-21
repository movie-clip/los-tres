import { describe, expect, it } from 'vitest';

import type { PublicProductPage } from '@/server/catalogue/product-page';
import { buildProductJsonLd, serializeJsonLd } from '@/server/catalogue/product-jsonld';

const offer = (offerId: number, priceCents: number) => ({
  offerId,
  shopName: `Tienda ${offerId}`,
  priceCents,
  priceUpdatedAt: new Date('2026-10-01T10:00:00Z'),
});

const product = (o: Partial<PublicProductPage> = {}): PublicProductPage => ({
  slug: 'producto',
  title: 'Filtro de aceite',
  brand: 'MarcaF',
  partNumber: 'OC 1234',
  ean: '2000000000015',
  description: 'Texto plano',
  offers: [offer(1, 1149), offer(2, 1299)],
  demoOnly: false,
  ...o,
});

describe('buildProductJsonLd', () => {
  it('builds the full Product with one AggregateOffer', () => {
    expect(buildProductJsonLd(product())).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Filtro de aceite',
      description: 'Texto plano',
      brand: { '@type': 'Brand', name: 'MarcaF' },
      mpn: 'OC 1234',
      gtin: '2000000000015',
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'EUR',
        lowPrice: '11.49',
        highPrice: '12.99',
        offerCount: 2,
      },
    });
  });

  it('omits brand, description, mpn and gtin keys when the values are null', () => {
    const json = buildProductJsonLd(
      product({ brand: null, description: null, partNumber: null, ean: null }),
    ) as Record<string, unknown>;
    for (const key of ['brand', 'description', 'mpn', 'gtin']) {
      expect(Object.keys(json)).not.toContain(key);
    }
    expect(json.name).toBe('Filtro de aceite');
  });

  it.each([
    ['123', false],
    ['1234567', false],
    ['12345678', true],
    ['123456789012', true],
    ['2000000000015', true],
    ['20000000000150', true],
    ['123456789012345', false],
    ['200000000001x', false],
    ['123456789', false],
  ])('ean %s emits gtin: %s', (ean, emitted) => {
    const json = buildProductJsonLd(product({ ean }));
    if (emitted) expect(json).toHaveProperty('gtin', ean);
    else expect(json).not.toHaveProperty('gtin');
  });

  it('takes low and high as min and max of unsorted offers', () => {
    const json = buildProductJsonLd(
      product({ offers: [offer(1, 2500), offer(2, 99), offer(3, 100000), offer(4, 700)] }),
    );
    expect(json?.offers).toMatchObject({ lowPrice: '0.99', highPrice: '1000.00', offerCount: 4 });
  });

  it('gives equal low and high for one offer', () => {
    const json = buildProductJsonLd(product({ offers: [offer(1, 4990)] }));
    expect(json?.offers).toMatchObject({ lowPrice: '49.90', highPrice: '49.90', offerCount: 1 });
  });

  it('sets offerCount to the number of offers', () => {
    const offers = [1, 2, 3, 4, 5].map((id) => offer(id, 1000 + id));
    expect(buildProductJsonLd(product({ offers }))?.offers.offerCount).toBe(5);
  });

  it('returns null when there is no offer, so no price is stated', () => {
    expect(buildProductJsonLd(product({ offers: [] }))).toBeNull();
  });

  it('carries prices as strings, never numbers', () => {
    const offers = buildProductJsonLd(product())?.offers;
    expect(typeof offers?.lowPrice).toBe('string');
    expect(typeof offers?.highPrice).toBe('string');
  });

  it('does not leak shop names, offer ids or affiliate urls', () => {
    const text = JSON.stringify(buildProductJsonLd(product()));
    expect(text).not.toContain('Tienda');
    expect(text).not.toContain('/go/');
    expect(text).not.toContain('offerId');
  });
});

describe('serializeJsonLd', () => {
  const hostile = {
    name: '</script><script>alert(1)</script> <!-- & "q" \u2028 \u2029 fin',
  };

  it('escapes <, >, & so the text cannot close the script tag', () => {
    const out = serializeJsonLd(hostile);
    expect(out).not.toMatch(/[<>&]/);
    expect(out.toLowerCase()).not.toContain('</script');
    expect(out).not.toContain('<!--');
    expect(out).toContain(String.raw`\u003c`);
    expect(out).toContain(String.raw`\u003e`);
    expect(out).toContain(String.raw`\u0026`);
  });

  it('escapes U+2028 and U+2029', () => {
    const out = serializeJsonLd(hostile);
    expect(out).not.toContain('\u2028');
    expect(out).not.toContain('\u2029');
    expect(out).toContain(String.raw`\u2028`);
    expect(out).toContain(String.raw`\u2029`);
  });

  it('round-trips to the original value through JSON.parse', () => {
    expect(JSON.parse(serializeJsonLd(hostile))).toEqual(hostile);
  });

  it('round-trips a built product with a hostile title', () => {
    const built = buildProductJsonLd(
      product({ title: '</script><img src=x onerror=alert(1)>', brand: 'A&B <b>' }),
    );
    const out = serializeJsonLd(built);
    expect(out).not.toMatch(/[<>&]/);
    expect(JSON.parse(out)).toEqual(built);
  });
});
