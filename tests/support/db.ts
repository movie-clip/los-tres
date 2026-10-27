import { sql } from 'drizzle-orm';

import { ensureFixedCategoryTree } from '@/db/category-tree';
import { getDb } from '@/db/client';

/**
 * Any helper that mutates the database calls this first. Fails unless the
 * connection is on a `_test` database, so a test can never write to the
 * development database.
 */
export async function assertTestDatabase(): Promise<void> {
  const result = await getDb().execute<{ name: string }>(sql`select current_database() as name`);
  const name = result.rows[0]?.name ?? '';
  if (!name.endsWith('_test')) {
    throw new Error('Refusing to run: the connected database is not a _test database');
  }
}

/**
 * Empties every table in schema `public` and restarts identities, so each test
 * starts from the migrated state, which includes the fixed category tree (ids 1-6),
 * re-created after the truncate. Drizzle's own migrations table lives
 * in schema `drizzle` and is left alone. Integration files call this in
 * `beforeEach`.
 */
export async function resetDatabase(): Promise<void> {
  await assertTestDatabase();
  const db = getDb();
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '%drizzle%'`,
  );
  if (tables.rows.length > 0) {
    const names = tables.rows.map((row) => `"public"."${row.tablename.replace(/"/g, '""')}"`).join(', ');
    await db.execute(sql.raw(`truncate table ${names} restart identity cascade`));
  }
  await ensureFixedCategoryTree(db);
}
