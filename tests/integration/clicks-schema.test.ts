import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { clicks, offers } from '@/db/schema';

import { resetDatabase } from '../support/db';
import { insertGoOffer } from '../support/go';
import { pgErrorOf } from '../support/pg-error';

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

describe('clicks table (guardrail 5: the row shape is the contract)', () => {
  it('has exactly these columns and no others, so a new column fails here on purpose', async () => {
    const result = await getDb().execute<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
    }>(
      sql`select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'clicks' order by column_name`,
    );
    expect(result.rows).toEqual([
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'offer_id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'product_id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'shop_id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'source_page', data_type: 'text', is_nullable: 'YES' },
    ]);
  });

  async function insertClick(sourcePage: string | null) {
    const { shop, product, offerId } = await insertGoOffer();
    return getDb()
      .insert(clicks)
      .values({ offerId, shopId: shop.id, productId: product.id, sourcePage });
  }

  it.each([
    ['a full URL', 'https://x.example/a'],
    ['a query string', '/a?b=1'],
    ['an uppercase path', '/A'],
    ['a protocol-relative path', '//a'],
    ['a fragment', '/a#b'],
    ['a percent escape', '/a%20b'],
    ['a path of 201 characters', `/${'a'.repeat(200)}`],
  ])('rejects source_page with %s', async (_name, value) => {
    const error = await pgErrorOf(insertClick(value));
    expect(error.code).toBe('23514');
    expect(error.constraint).toBe('clicks_source_page_format');
  });

  it.each([
    ['null', null],
    ['the root', '/'],
    ['a product path', '/producto/x'],
    ['a path of exactly 200 characters', `/${'a'.repeat(199)}`],
  ])('accepts source_page %s', async (_name, value) => {
    await insertClick(value);
    const rows = await getDb().select().from(clicks);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourcePage).toBe(value);
  });

  it('sets created_at from the database clock', async () => {
    await insertClick(null);
    const [row] = await getDb().select().from(clicks);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('references offer, shop and product with ON DELETE RESTRICT, so history is never cascaded away', async () => {
    const result = await getDb().execute<{ referenced: string; delete_rule: string }>(sql`
      select ccu.table_name as referenced, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.unique_constraint_name
      where tc.table_schema = 'public' and tc.table_name = 'clicks' and tc.constraint_type = 'FOREIGN KEY'
      order by ccu.table_name`);
    expect(result.rows).toEqual([
      { referenced: 'offers', delete_rule: 'RESTRICT' },
      { referenced: 'products', delete_rule: 'RESTRICT' },
      { referenced: 'shops', delete_rule: 'RESTRICT' },
    ]);
  });

  it('refuses to delete an offer that has a click (23503)', async () => {
    const { shop, product, offerId } = await insertGoOffer();
    await getDb()
      .insert(clicks)
      .values({ offerId, shopId: shop.id, productId: product.id, sourcePage: null });
    const error = await pgErrorOf(getDb().delete(offers).where(sql`${offers.id} = ${offerId}`));
    expect(error.code).toBe('23503');
  });
});
