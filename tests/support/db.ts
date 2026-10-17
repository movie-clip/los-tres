import { sql } from 'drizzle-orm';

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
