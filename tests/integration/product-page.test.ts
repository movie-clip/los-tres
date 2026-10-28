import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eq } from 'drizzle-orm';

import { closeDb, getDb } from '@/db/client';
import { categories } from '@/db/schema';
import { importFeeds } from '@/server/importer';
import { getPublicProductBySlug, type PublicProductPage } from '@/server/catalogue/product-page';

import {
  insertCategory,
  insertCategoryMapping,
  insertFeed,
  insertFixtureFeed,
  insertListedProduct,
  insertOffer,
  insertProduct,
  insertShop,
  productBySlug,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { fixtureDeps } from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

describe('getPublicProductBySlug shape (C-11)', () => {
  it('returns exactly the contract keys, with integer cents and a Date', async () => {
    const shop = await insertShop({ name: 'Tienda Forma' });
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({
      slug: 'forma',
      title: 'Producto forma',
      brand: 'MarcaF',
      partNumber: 'PN 1',
      ean: '2000000000015',
      description: 'Texto plano',
    });
    const updated = new Date('2026-10-05T08:30:00Z');
    const offerId = await insertOffer({
      productId: product.id,
      feedId,
      priceCents: 1999,
      priceUpdatedAt: updated,
    });

    const page = await getPublicProductBySlug('forma');

    // toEqual on the whole value: adding `url`, `shopCount` or an internal id
    // to the public contract fails here on purpose.
    expect(page).toEqual({
      slug: 'forma',
      title: 'Producto forma',
      brand: 'MarcaF',
      partNumber: 'PN 1',
      ean: '2000000000015',
      description: 'Texto plano',
      offers: [
        {
          offerId,
          shopName: 'Tienda Forma',
          priceCents: 1999,
          priceUpdatedAt: updated,
          isBestPrice: false,
        },
      ],
      categorySlug: 'categoria-de-prueba',
      categoryTrail: [{ slug: 'categoria-de-prueba', name: 'Categoría de prueba' }],
      demoOnly: false,
      indexable: true,
    } satisfies PublicProductPage);
    expect(page?.offers[0].priceUpdatedAt).toBeInstanceOf(Date);
    expect(Number.isInteger(page?.offers[0].priceCents)).toBe(true);
  });

  it('never exposes the affiliate url of an offer', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({ slug: 'sin-url' });
    await insertOffer({
      productId: product.id,
      feedId,
      url: 'https://affiliate.example/secret-tracking-link',
    });
    const page = await getPublicProductBySlug('sin-url');
    expect(JSON.stringify(page)).not.toContain('affiliate.example');
    expect(JSON.stringify(page)).not.toContain('secret-tracking-link');
  });

  it('keeps null brand, part number, EAN and description as null', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({ slug: 'solo-titulo', title: 'Solo titulo' });
    await insertOffer({ productId: product.id, feedId });
    const page = await getPublicProductBySlug('solo-titulo');
    expect(page).toMatchObject({
      title: 'Solo titulo',
      brand: null,
      partNumber: null,
      ean: null,
      description: null,
    });
  });

  it('returns description text as stored, without interpreting markup', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({
      slug: 'con-html',
      description: '<b>negrita</b> & <script>x()</script>',
    });
    await insertOffer({ productId: product.id, feedId });
    expect((await getPublicProductBySlug('con-html'))?.description).toBe(
      '<b>negrita</b> & <script>x()</script>',
    );
  });

  it('stores empty feed cells as null and the page returns them as null', async () => {
    const { feedId } = await insertFixtureFeed('empty-cells.csv');
    // The fixture's only filled optional cell is its category, mapped so the page is public.
    await insertCategoryMapping(feedId, 'Varios', (await insertCategory()).id);
    await importFeeds(getDb(), { deps: fixtureDeps });

    const stored = await productBySlug('producto-con-celdas-vacias');
    expect(stored.brand).toBeNull();
    expect(stored.brandNormalised).toBeNull();
    expect(stored.partNumber).toBeNull();
    expect(stored.partNumberNormalised).toBeNull();
    expect(stored.ean).toBeNull();
    expect(stored.eanNormalised).toBeNull();
    expect(stored.description).toBeNull();

    const page = await getPublicProductBySlug('producto-con-celdas-vacias');
    expect(page).toMatchObject({ brand: null, partNumber: null, ean: null, description: null });
  });
});

describe('getPublicProductBySlug category trail (S11.5)', () => {
  async function productIn(slug: string, categoryId: number) {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({ slug, categoryId });
    await insertOffer({ productId: product.id, feedId });
  }

  it('is a single crumb for a product in a root category', async () => {
    const root = await insertCategory({ slug: 'raiz-sola', name: 'Raíz sola' });
    await productIn('en-raiz', root.id);
    const page = await getPublicProductBySlug('en-raiz');
    expect(page?.categoryTrail).toEqual([{ slug: 'raiz-sola', name: 'Raíz sola' }]);
    expect(page?.categorySlug).toBe('raiz-sola');
  });

  it('is root first and ends with the own category for a child', async () => {
    const root = await insertCategory({ slug: 'padre', name: 'Padre' });
    const child = await insertCategory({ slug: 'hijo', name: 'Hijo', parentId: root.id });
    await productIn('en-hijo', child.id);
    const page = await getPublicProductBySlug('en-hijo');
    expect(page?.categoryTrail).toEqual([
      { slug: 'padre', name: 'Padre' },
      { slug: 'hijo', name: 'Hijo' },
    ]);
    expect(page?.categoryTrail.at(-1)?.slug).toBe(page?.categorySlug);
  });

  it('holds three crumbs, root first, for a three-level chain', async () => {
    const root = await insertCategory({ slug: 'nivel-1', name: 'Nivel 1' });
    const mid = await insertCategory({ slug: 'nivel-2', name: 'Nivel 2', parentId: root.id });
    const leaf = await insertCategory({ slug: 'nivel-3', name: 'Nivel 3', parentId: mid.id });
    await productIn('en-nivel-3', leaf.id);
    const page = await getPublicProductBySlug('en-nivel-3');
    expect(page?.categoryTrail.map((crumb) => crumb.slug)).toEqual(['nivel-1', 'nivel-2', 'nivel-3']);
    expect(page?.categoryTrail.map((crumb) => crumb.name)).toEqual(['Nivel 1', 'Nivel 2', 'Nivel 3']);
  });

  it('exposes only slug and name on a crumb, never an internal id', async () => {
    const root = await insertCategory({ slug: 'solo-dos', name: 'Solo dos' });
    const child = await insertCategory({ slug: 'solo-dos-hijo', name: 'Hijo', parentId: root.id });
    await productIn('sin-ids', child.id);
    const page = await getPublicProductBySlug('sin-ids');
    for (const crumb of page?.categoryTrail ?? []) {
      expect(Object.keys(crumb).sort()).toEqual(['name', 'slug']);
    }
  });

  it('terminates on a parent cycle with a bounded trail that ends at the own category', async () => {
    const a = await insertCategory({ slug: 'ciclo-a', name: 'Ciclo A' });
    const b = await insertCategory({ slug: 'ciclo-b', name: 'Ciclo B', parentId: a.id });
    await getDb().update(categories).set({ parentId: b.id }).where(eq(categories.id, a.id));
    await productIn('en-ciclo', b.id);

    const page = await getPublicProductBySlug('en-ciclo');
    expect(page).not.toBeNull();
    const trail = page?.categoryTrail ?? [];
    expect(trail.length).toBeGreaterThanOrEqual(1);
    expect(trail.length).toBeLessThanOrEqual(9);
    expect(trail.at(-1)?.slug).toBe('ciclo-b');
  });

  it('truncates a chain deeper than the cap at the root end instead of failing', async () => {
    let parentId: number | null = null;
    let last = { id: 0, slug: '' };
    for (let level = 1; level <= 12; level += 1) {
      last = await insertCategory({ slug: `hondo-${level}`, name: `Hondo ${level}`, parentId });
      parentId = last.id;
    }
    await productIn('muy-hondo', last.id);
    const trail = (await getPublicProductBySlug('muy-hondo'))?.categoryTrail ?? [];
    expect(trail.length).toBeLessThanOrEqual(9);
    expect(trail.at(-1)?.slug).toBe('hondo-12');
  });

  it('follows the real fixed tree: the root, then the leaf', async () => {
    const [leaf] = await getDb()
      .select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(categories)
      .where(eq(categories.slug, 'filtros-de-aire'));
    await productIn('en-arbol-fijo', leaf.id);
    const trail = (await getPublicProductBySlug('en-arbol-fijo'))?.categoryTrail ?? [];
    expect(trail).toHaveLength(2);
    expect(trail[0].slug).toBe('mantenimiento-del-coche');
    expect(trail[1]).toEqual({ slug: leaf.slug, name: leaf.name });
  });
});

describe('getPublicProductBySlug best price (S11.5, D-1)', () => {
  async function flagsFor(slug: string, prices: number[]) {
    await insertListedProduct({ slug, prices });
    const page = await getPublicProductBySlug(slug);
    return page?.offers.map((offer) => [offer.priceCents, offer.isBestPrice]);
  }

  it('flags both offers of a tie at the lowest price and not the dearer one', async () => {
    expect(await flagsFor('empate', [1130, 1049, 1049])).toEqual([
      [1049, true],
      [1049, true],
      [1130, false],
    ]);
  });

  it('flags only the cheapest of distinct prices', async () => {
    expect(await flagsFor('distintos', [1530, 1195, 1295])).toEqual([
      [1195, true],
      [1295, false],
      [1530, false],
    ]);
  });

  it('flags nothing for a single offer', async () => {
    expect(await flagsFor('una', [1049])).toEqual([[1049, false]]);
  });

  it('flags nothing when every offer has the same price', async () => {
    expect(await flagsFor('iguales', [1049, 1049, 1049])).toEqual([
      [1049, false],
      [1049, false],
      [1049, false],
    ]);
  });

  it('does not let a cheaper hidden offer take the flag away from the visible cheapest', async () => {
    const product = await insertProduct({ slug: 'oculta-barata' });
    const flagged = await insertFeed((await insertShop()).id);
    const dearer = await insertFeed((await insertShop()).id);
    const hiddenFeed = await insertFeed((await insertShop()).id);
    await insertOffer({ productId: product.id, feedId: hiddenFeed, priceCents: 100, isHidden: true });
    await insertOffer({ productId: product.id, feedId: flagged, priceCents: 1000 });
    await insertOffer({ productId: product.id, feedId: dearer, priceCents: 1200 });

    const page = await getPublicProductBySlug('oculta-barata');
    expect(page?.offers.map((offer) => [offer.priceCents, offer.isBestPrice])).toEqual([
      [1000, true],
      [1200, false],
    ]);
  });

  it('does not let a cheaper offer of an unapproved feed take the flag away', async () => {
    const product = await insertProduct({ slug: 'feed-sin-aprobar' });
    const approved = await insertFeed((await insertShop()).id);
    const approvedDear = await insertFeed((await insertShop()).id);
    const unapproved = await insertFeed((await insertShop()).id, { isApproved: false });
    await insertOffer({ productId: product.id, feedId: unapproved, priceCents: 50 });
    await insertOffer({ productId: product.id, feedId: approved, priceCents: 900 });
    await insertOffer({ productId: product.id, feedId: approvedDear, priceCents: 950 });

    const page = await getPublicProductBySlug('feed-sin-aprobar');
    expect(page?.offers.map((offer) => [offer.priceCents, offer.isBestPrice])).toEqual([
      [900, true],
      [950, false],
    ]);
  });

  it('flags nothing when hiding the dearer offer leaves a single visible one', async () => {
    const product = await insertProduct({ slug: 'queda-una' });
    const cheap = await insertFeed((await insertShop()).id);
    const dear = await insertFeed((await insertShop()).id);
    await insertOffer({ productId: product.id, feedId: cheap, priceCents: 500 });
    await insertOffer({ productId: product.id, feedId: dear, priceCents: 900, isHidden: true });

    const page = await getPublicProductBySlug('queda-una');
    expect(page?.offers.map((offer) => [offer.priceCents, offer.isBestPrice])).toEqual([[500, false]]);
  });

  it('never returns a page, so flags nothing, when every offer is hidden or unapproved', async () => {
    const product = await insertProduct({ slug: 'sin-visibles' });
    const hiddenFeed = await insertFeed((await insertShop()).id);
    const unapproved = await insertFeed((await insertShop()).id, { isApproved: false });
    await insertOffer({ productId: product.id, feedId: hiddenFeed, isHidden: true });
    await insertOffer({ productId: product.id, feedId: unapproved });
    expect(await getPublicProductBySlug('sin-visibles')).toBeNull();
  });
});

describe('getPublicProductBySlug blank text fields (S11.5)', () => {
  it('returns blank brand, part number, EAN and description as null', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({
      slug: 'en-blanco',
      brand: '  ',
      partNumber: '',
      ean: ' ',
      description: '  \n ',
    });
    await insertOffer({ productId: product.id, feedId });
    const page = await getPublicProductBySlug('en-blanco');
    expect(page).toMatchObject({ brand: null, partNumber: null, ean: null, description: null });
  });

  it('trims a padded value instead of returning it as stored', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({
      slug: 'con-espacios',
      brand: ' MarcaX ',
      partNumber: ' OC 1 ',
      ean: ' 2000000000015 ',
      description: '  Texto  ',
    });
    await insertOffer({ productId: product.id, feedId });
    const page = await getPublicProductBySlug('con-espacios');
    expect(page).toMatchObject({
      brand: 'MarcaX',
      partNumber: 'OC 1',
      ean: '2000000000015',
      description: 'Texto',
    });
  });

  it('does not make one blank field null its neighbours', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({ slug: 'mixto', brand: '   ', partNumber: 'REF-9' });
    await insertOffer({ productId: product.id, feedId });
    const page = await getPublicProductBySlug('mixto');
    expect(page?.brand).toBeNull();
    expect(page?.partNumber).toBe('REF-9');
  });
});

describe('getPublicProductBySlug ordering (C-11)', () => {
  it('orders offers by price, then shop name, then offer id, in SQL', async () => {
    const product = await insertProduct({ slug: 'orden' });
    // Inserted in the order that would be wrong if the database did not sort:
    // Zeta first (lowest ids), the cheapest last.
    const zeta = await insertShop({ name: 'Zeta' });
    const alfa1 = await insertShop({ name: 'Alfa' });
    const alfa2 = await insertShop({ name: 'Alfa' });
    const cheap = await insertShop({ name: 'Mitad' });
    const zetaOffer = await insertOffer({ productId: product.id, feedId: await insertFeed(zeta.id), priceCents: 1000 });
    const alfaOffer1 = await insertOffer({ productId: product.id, feedId: await insertFeed(alfa1.id), priceCents: 1000 });
    const alfaOffer2 = await insertOffer({ productId: product.id, feedId: await insertFeed(alfa2.id), priceCents: 1000 });
    const cheapOffer = await insertOffer({ productId: product.id, feedId: await insertFeed(cheap.id), priceCents: 900 });

    const page = await getPublicProductBySlug('orden');
    expect(page?.offers.map((offer) => offer.offerId)).toEqual([
      cheapOffer, // 900 first
      alfaOffer1, // price tie: shop name Alfa before Zeta
      alfaOffer2, // same price, same shop name: lower offer id first
      zetaOffer,
    ]);
  });

  it('puts the cheaper of the two demo-style shops first', async () => {
    const product = await insertProduct({ slug: 'dos-tiendas' });
    const dearShop = await insertShop({ name: 'Tienda Demo Uno' });
    const cheapShop = await insertShop({ name: 'Tienda Demo Dos' });
    await insertOffer({ productId: product.id, feedId: await insertFeed(dearShop.id), priceCents: 1299 });
    await insertOffer({ productId: product.id, feedId: await insertFeed(cheapShop.id), priceCents: 1149 });
    const page = await getPublicProductBySlug('dos-tiendas');
    expect(page?.offers.map((offer) => [offer.shopName, offer.priceCents])).toEqual([
      ['Tienda Demo Dos', 1149],
      ['Tienda Demo Uno', 1299],
    ]);
  });
});
