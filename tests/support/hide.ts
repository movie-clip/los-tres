import { sql } from 'drizzle-orm';

import { getDb } from '@/db/client';

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
