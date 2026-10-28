import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { importFeeds } from '@/server/importer';
import { getPublicProductBySlug, type PublicProductPage } from '@/server/catalogue/product-page';

import {
  insertCategory,
  insertCategoryMapping,
  insertFeed,
  insertFixtureFeed,
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
