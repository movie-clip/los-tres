import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';

import { insertFeed, insertProduct, insertShop } from '../support/catalogue';
import { assertTestDatabase, resetDatabase } from '../support/db';
import { pgErrorOf } from '../support/pg-error';

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

describe('money columns (guardrail 4)', () => {
  it('has no real, double precision, numeric or money column in schema public', async () => {
    const result = await getDb().execute<{ table_name: string; column_name: string; udt_name: string }>(
      sql`select table_name, column_name, udt_name from information_schema.columns where table_schema = 'public'`,
    );
    expect(result.rows.length).toBeGreaterThan(0);
    const floaty = result.rows.filter((row) =>
      ['float4', 'float8', 'numeric', 'money'].includes(row.udt_name),
    );
    expect(floaty).toEqual([]);
  });

  it('types every *_cents column as integer', async () => {
    const result = await getDb().execute<{ column_name: string; data_type: string }>(
      sql`select column_name, data_type from information_schema.columns where table_schema = 'public' and column_name like '%\_cents'`,
    );
    expect(result.rows.map((row) => row.column_name)).toContain('price_cents');
    for (const row of result.rows) {
      expect(row.data_type).toBe('integer');
    }
  });

  it.each([0, -1])('rejects price_cents = %i with the positive-price check', async (price) => {
    await assertTestDatabase();
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct();
    const error = await pgErrorOf(
      getDb().insert(offers).values({
        productId: product.id,
        feedId,
        externalId: 'zero',
        priceCents: price,
        url: 'https://affiliate.example/x',
        priceUpdatedAt: new Date(),
      }),
    );
    expect(error).toEqual({ code: '23514', constraint: 'offers_price_cents_positive' });
  });
});

describe('default-deny (guardrail 1)', () => {
  it('a row inserted with no flags is unapproved, not hidden and not in review', async () => {
    const db = getDb();
    const [shop] = await db.insert(shops).values({ name: 'S', slug: 's' }).returning();
    const [feed] = await db
      .insert(feeds)
      .values({ shopId: shop.id, sourceType: 'shop_upload', url: 'f.csv' })
      .returning();
    const [product] = await db.insert(products).values({ slug: 'p', title: 'P' }).returning();
    const [offer] = await db
      .insert(offers)
      .values({
        productId: product.id,
        feedId: feed.id,
        externalId: 'e',
        priceCents: 100,
        url: 'https://affiliate.example/x',
        priceUpdatedAt: new Date(),
      })
      .returning();

    expect(shop.isApproved).toBe(false);
    expect(feed.isApproved).toBe(false);
    expect(feed.isDemo).toBe(false);
    expect(product.isHidden).toBe(false);
    expect(offer.isHidden).toBe(false);
    expect(offer.inReview).toBe(false);
  });
});

describe('integrity constraints', () => {
  it('rejects a product slug that is not lower-case hyphenated ASCII', async () => {
    const error = await pgErrorOf(getDb().insert(products).values({ slug: 'Bad_Slug', title: 'x' }));
    expect(error).toEqual({ code: '23514', constraint: 'products_slug_format' });
  });

  it('accepts a well-formed slug', async () => {
    await expect(insertProduct({ slug: 'filtro-oc-1234' })).resolves.toMatchObject({
      slug: 'filtro-oc-1234',
    });
  });

  it('rejects an affiliate_network feed with no network', async () => {
    const shop = await insertShop();
    const error = await pgErrorOf(
      getDb().insert(feeds).values({ shopId: shop.id, sourceType: 'affiliate_network', url: 'u' }),
    );
    expect(error).toEqual({ code: '23514', constraint: 'feeds_affiliate_network_required' });
  });

  it('rejects a second offer with the same (feed, external id)', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct();
    const row = {
      productId: product.id,
      feedId,
      externalId: 'same',
      priceCents: 100,
      url: 'https://affiliate.example/x',
      priceUpdatedAt: new Date(),
    };
    await getDb().insert(offers).values(row);
    const error = await pgErrorOf(getDb().insert(offers).values(row));
    expect(error.code).toBe('23505');
    expect(error.constraint).toBe('offers_feed_id_external_id_unique');
  });

  it('refuses to delete a shop that still has a feed (on delete restrict)', async () => {
    const shop = await insertShop();
    await insertFeed(shop.id);
    const error = await pgErrorOf(getDb().execute(sql`delete from shops where id = ${shop.id}`));
    expect(error.code).toBe('23503');
  });
});
