import { asc, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { categories, clicks, feedCategoryMappings, feeds, fitments, offers, products, shops } from '@/db/schema';

import { assertTestDatabase } from './db';

// Support for the S2.4 hide tests.

/** FormData from a plain object; a value is sent as text, so an id is "7". */
export function hideForm(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, String(value));
  return data;
}

/**
 * Runs `run` while every update of a product or an offer raises an exception
 * whose message carries every product slug, so a leak of the failure text into
 * a log or a state shows up. The triggers are dropped in `finally`.
 */
export async function withFailingHideWrites<T>(run: () => Promise<T>): Promise<T> {
  await assertTestDatabase();
  const db = getDb();
  await db.execute(
    sql.raw(
      "create function fail_hide_write() returns trigger language plpgsql as $$ begin raise exception 'boom %', (select string_agg(slug, ',') from products) using errcode = 'P0001'; end $$",
    ),
  );
  await db.execute(sql.raw('create trigger fail_hide_write before update on products for each row execute function fail_hide_write()'));
  await db.execute(sql.raw('create trigger fail_hide_write before update on offers for each row execute function fail_hide_write()'));
  try {
    return await run();
  } finally {
    await db.execute(sql.raw('drop trigger if exists fail_hide_write on products'));
    await db.execute(sql.raw('drop trigger if exists fail_hide_write on offers'));
    await db.execute(sql.raw('drop function if exists fail_hide_write()'));
  }
}

/**
 * Every row of every table a hide or an unhide must not change, whole and in id order (AC 44).
 * Compared before and after with the hidden flags set apart by `withoutHiddenFlags`.
 */
export async function allRows() {
  await assertTestDatabase();
  const db = getDb();
  return {
    products: await db.select().from(products).orderBy(asc(products.id)),
    offers: await db.select().from(offers).orderBy(asc(offers.id)),
    feeds: await db.select().from(feeds).orderBy(asc(feeds.id)),
    shops: await db.select().from(shops).orderBy(asc(shops.id)),
    categories: await db.select().from(categories).orderBy(asc(categories.id)),
    mappings: await db.select().from(feedCategoryMappings).orderBy(asc(feedCategoryMappings.id)),
    fitments: await db.select().from(fitments).orderBy(asc(fitments.id)),
    clicks: await db.select().from(clicks).orderBy(asc(clicks.id)),
  };
}

/** `allRows()` with the two hidden flags forced to false, so a hidden state compares to a clear one. */
export function withoutHiddenFlags(rows: Awaited<ReturnType<typeof allRows>>) {
  return {
    ...rows,
    products: rows.products.map((row) => ({ ...row, isHidden: false })),
    offers: rows.offers.map((row) => ({ ...row, isHidden: false })),
  };
}
