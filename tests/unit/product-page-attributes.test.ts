import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'use-intl/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductAttributes, PublicProductPage } from '@/server/catalogue/product-page';
import { buildProductJsonLd, serializeJsonLd } from '@/server/catalogue/product-jsonld';

import messages from '../../messages/es-ES.json';

// S15.3 (US-15.3) ACs 36 to 40, the page's wiring: the real product page is rendered over a product the
// reader returns (the pattern of category-subcategory-links.test.ts: the loaders are mocked, the page and its
// components are real, the copy is the real es-ES message file). What is proved here is what the page does
// with `product.attributes`: which rows it builds, in which order, the Spanish word of each oil family, the
// number behind the approvals control, where the card sits, and that a null reader answer draws nothing. The
// reader itself (category gate, held values) is integration/product-page.test.ts. No database.

const { productHolder } = vi.hoisted(() => ({ productHolder: { current: null as unknown } }));

vi.mock('next-intl/server', async () => {
  const { createTranslator: create } = await import('use-intl/core');
  const real = (await import('../../messages/es-ES.json')).default;
  return {
    getTranslations: async (namespace: 'Product') => create({ locale: 'es-ES', messages: real, namespace }),
  };
});
vi.mock('@/server/car/context', async () => {
  const state = await import('@/server/car/state');
  return {
    getCarContext: async () => ({ state: 'none', path: null }),
    openedWithCoche: state.openedWithCoche,
    selectedSlug: state.selectedSlug,
  };
});
vi.mock('@/server/catalogue/product-fit', () => ({
  getProductFit: async () => ({ banner: null, vehicles: [] }),
}));
vi.mock('@/server/catalogue/product-page', () => ({
  getPublicProductBySlug: async () => productHolder.current,
}));

const t = createTranslator({ locale: 'es-ES', messages, namespace: 'Product' });

const offer = (offerId: number, priceCents: number) => ({
  offerId,
  shopName: `Tienda ${offerId}`,
  priceCents,
  priceUpdatedAt: new Date('2026-10-01T10:00:00Z'),
  isBestPrice: offerId === 1,
});

const NO_ATTRIBUTES: ProductAttributes = { viscosity: null, volume: null, acea: null, oilType: null, approvals: null };
const ALL: ProductAttributes = {
  viscosity: '10W-40',
  volume: '1,5 l',
  acea: ['A3/B4', 'C2'],
  oilType: 'semi-synthetic',
  approvals: ['VW 504 00', 'VW 507 00', 'MB-Freigabe 229.51'],
};

const product = (attributes: ProductAttributes | null, o: Partial<PublicProductPage> = {}): PublicProductPage => ({
  slug: 'aceite-prueba',
  title: 'Aceite de prueba',
  brand: 'MarcaF',
  partNumber: 'REF-1',
  ean: '2000000000015',
  description: 'Texto plano de la descripcion',
  offers: [offer(1, 1149), offer(2, 1299)],
  categorySlug: 'aceite-de-motor',
  categoryTrail: [
    { slug: 'mantenimiento-del-coche', name: 'Mantenimiento del coche' },
    { slug: 'aceite-de-motor', name: 'Aceite de motor' },
  ],
  demoOnly: false,
  indexable: true,
  attributes,
  ...o,
});

async function render(page: PublicProductPage): Promise<string> {
  productHolder.current = page;
  const { default: ProductPage } = await import('@/app/(public)/producto/[slug]/page');
  return renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ slug: page.slug }) }));
}

const terms = (html: string) => [...html.matchAll(/<dt\b[^>]*>(.*?)<\/dt>/g)].map((match) => match[1]);
const card = (html: string) => html.match(/<section\b[^>]*data-testid="product-attributes"[\s\S]*?<\/section>/)?.[0] ?? '';
const textOf = (html: string) => html.replace(/<[^>]+>/g, '');

beforeEach(() => {
  productHolder.current = null;
});

describe('the product page builds the Características card from product.attributes (AC 36, 38)', () => {
  it('draws the five rows in the spec order with the labels of the message file, and the values as the reader gave them', async () => {
    const html = await render(product(ALL));
    const section = card(html);

    expect(section).not.toBe('');
    expect(section).toContain(`>${messages.Product.attributesHeading}</h2>`);
    expect(terms(section)).toEqual([
      messages.Product.attributeLabel.viscosity,
      messages.Product.attributeLabel.volume,
      messages.Product.attributeLabel.acea,
      messages.Product.attributeLabel.oilType,
      messages.Product.attributeLabel.approvals,
    ]);
    const text = textOf(section);
    expect(text).toContain('10W-40');
    expect(text).toContain('1,5 l');
    expect(text).toContain('A3/B4, C2');
    for (const item of ALL.approvals ?? []) expect(text).toContain(item);
  });

  it.each([
    ['synthetic', 'Sintético'],
    ['semi-synthetic', 'Semisintético'],
    ['mineral', 'Mineral'],
  ] as const)('shows the oil family %s as the Spanish word %s, from the message file and never the key', async (family, word) => {
    const section = card(await render(product({ ...NO_ATTRIBUTES, oilType: family })));
    expect(word).toBe(t(`oilType.${family}`));
    expect(textOf(section)).toContain(word);
    expect(textOf(section)).not.toContain(family === 'semi-synthetic' ? 'semi-synthetic' : family);
  });

  it('sits directly under the offers and above the description, between them on the page', async () => {
    const html = await render(product(ALL));
    const offers = html.indexOf(messages.Product.offersHeading);
    const cardAt = html.indexOf('data-testid="product-attributes"');
    const description = html.indexOf(`>${messages.Product.descriptionHeading}</h2>`);
    expect(offers).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(offers);
    expect(description).toBeGreaterThan(cardAt);
  });

  it('leaves the hero list as it was: only Referencia and EAN, whatever the card holds', async () => {
    const html = await render(product(ALL));
    const hero = html.slice(0, html.indexOf('data-testid="product-attributes"'));
    expect(terms(hero)).toEqual([messages.Product.partNumber, messages.Product.ean]);
  });

  it('shows markup characters of an approvals item as literal characters, never as markup', async () => {
    const html = await render(product({ ...NO_ATTRIBUTES, approvals: ['<b>VW</b> 504 00'] }));
    expect(card(html)).not.toContain('<b>');
    expect(card(html)).toContain('&lt;b&gt;VW&lt;/b&gt; 504 00');
  });
});

describe('an absent attribute draws no row, and none held draws no card (AC 37, 39)', () => {
  it('draws only the held attributes, in the spec order, when some are absent', async () => {
    const html = await render(product({ ...NO_ATTRIBUTES, viscosity: '5W-30', approvals: ['VW 504 00'] }));
    expect(terms(card(html))).toEqual([messages.Product.attributeLabel.viscosity, messages.Product.attributeLabel.approvals]);
  });

  it('draws no heading, block, placeholder or dash when the reader gives null: the page is the page without the card', async () => {
    const withNull = await render(product(null));
    const withEmpty = await render(product({ ...NO_ATTRIBUTES }));

    for (const html of [withNull, withEmpty]) {
      expect(html).not.toContain('product-attributes');
      expect(html).not.toContain(messages.Product.attributesHeading);
      for (const label of Object.values(messages.Product.attributeLabel)) expect(html).not.toContain(label);
    }
    expect(withEmpty).toBe(withNull);
  });

  it('keeps every other part of the page when a card is drawn: the offers, prices, description and structured data (AC 40)', async () => {
    const without = await render(product(null));
    const withCard = await render(product(ALL));
    // The page with the card, minus the card, is the page without it.
    expect(withCard.replace(card(withCard), '')).toBe(without);
    expect(without).toContain(messages.Product.offersHeading);
    expect(without).toContain('Texto plano de la descripcion');
    expect(without).toContain('application/ld+json');
  });
});

describe('the approvals control is wired from the number held (06-ux States)', () => {
  const approvals = (n: number) => Array.from({ length: n }, (_, index) => `Homologación demo ${index + 1}`);
  const withApprovals = (n: number) => render(product({ ...NO_ATTRIBUTES, approvals: approvals(n) }));

  it.each([1, 8])('%i approvals: no control', async (n) => {
    expect(card(await withApprovals(n))).not.toContain('<details');
  });

  it.each([
    [9, 1],
    [12, 4],
    [20, 12],
  ])('%i approvals: the control reads "Mostrar %i más" with the count behind it, and opened the other label', async (n, behind) => {
    const section = card(await withApprovals(n));
    expect(section).toContain(`>${t('approvalsMore', { count: behind })}</span>`);
    expect(section).toContain(`>${messages.Product.approvalsFewer}</span>`);
    expect(section.match(/<li\b/g)).toHaveLength(n);
    expect(section.split('<details')[0].match(/<li\b/g)).toHaveLength(8);
  });
});

describe('the attributes are in no structured data (AC 40)', () => {
  it('builds the same JSON-LD with and without attributes: nothing of the five reaches it', () => {
    const withAttributes = buildProductJsonLd(product(ALL));
    const without = buildProductJsonLd(product(null));
    expect(withAttributes).toEqual(without);
    const text = serializeJsonLd(withAttributes ?? {});
    for (const held of ['10W-40', '1,5 l', 'A3/B4', 'VW 504 00', 'semi-synthetic', 'Semisintético']) expect(text).not.toContain(held);
  });
});
