import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb } from '@/db/client';
import { buildProductJsonLd } from '@/server/catalogue/product-jsonld';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import { insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

// Guardrail 1: the JSON-LD is derived from the visible-offer read, so an offer
// that is hidden or from an unapproved feed cannot move a price or the count.
describe('product JSON-LD from the public read (guardrail 1)', () => {
  it('ignores hidden and unapproved-feed offers in low, high and offerCount', async () => {
    const shop = await insertShop();
    const approved = await insertFeed(shop.id);
    const unapproved = await insertFeed((await insertShop()).id, { isApproved: false });
    const product = await insertProduct({ slug: 'solo-visibles', title: 'Solo visibles' });

    await insertOffer({ productId: product.id, feedId: approved, priceCents: 2000 });
    await insertOffer({ productId: product.id, feedId: approved, priceCents: 3000 });
    await insertOffer({ productId: product.id, feedId: approved, priceCents: 1, isHidden: true });
    await insertOffer({ productId: product.id, feedId: unapproved, priceCents: 999999 });

    const page = await getPublicProductBySlug('solo-visibles');
    const json = buildProductJsonLd(page!);

    expect(json?.offers).toMatchObject({ lowPrice: '20.00', highPrice: '30.00', offerCount: 2 });
    expect(JSON.stringify(json)).not.toContain('0.01');
    expect(JSON.stringify(json)).not.toContain('9999.99');
  });

  it('has no page, so no JSON-LD, when every offer is hidden', async () => {
    const feedId = await insertFeed((await insertShop()).id);
    const product = await insertProduct({ slug: 'sin-visibles' });
    await insertOffer({ productId: product.id, feedId, priceCents: 500, isHidden: true });

    expect(await getPublicProductBySlug('sin-visibles')).toBeNull();
  });
});
