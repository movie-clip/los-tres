import { sql } from 'drizzle-orm';

import { getDb } from '@/db/client';

import { expectedWorkerDatabase } from './env';

/**
 * Any helper that mutates the database calls this first. Fails unless the
 * connection is on this worker's own database, `<db>_w<VITEST_POOL_ID>_test`,
 * so a test can never write to the development database, to the template or to
 * another worker's database. The expected name comes from `VITEST_POOL_ID`, not
 * from the connection, so a worker that reaches another worker's database fails.
 */
export async function assertTestDatabase(): Promise<void> {
  const result = await getDb().execute<{ name: string }>(sql`select current_database() as name`);
  const name = result.rows[0]?.name ?? '';
  let expected: string;
  try {
    expected = expectedWorkerDatabase(process.env.DATABASE_URL ?? '', process.env.VITEST_POOL_ID);
  } catch {
    throw new Error('Refusing to run: this process has no integration worker database');
  }
  if (name !== expected) {
    throw new Error('Refusing to run: the connected database is not this worker\'s own test database');
  }
}

/**
 * The schema holding a copy of the migrated reference rows. Global setup makes
 * it in the template (so every worker clone has it), outside `public`, so the
 * reset and the tests that read `public` never see it.
 */
export const FIXTURE_SCHEMA = 'test_fixture';

/**
 * Run once on the migrated template, after `runMigrations`: copies the rows the
 * real `ensureFixedCategoryTree` and `ensureVehicleCatalogue` wrote, so the
 * reset restores them with one insert instead of 57 upserts (S3, #337).
 */
export const SNAPSHOT_SQL = `
create schema ${FIXTURE_SCHEMA};
create table ${FIXTURE_SCHEMA}.categories as table public.categories;
create table ${FIXTURE_SCHEMA}.vehicles as table public.vehicles;`;

// One round trip, one implicit transaction. `session_replication_role = replica`
// switches the foreign keys off for it (the role is a superuser, as the Compose
// `db` user is), so the tables are emptied in any order. DELETE is used, not
// TRUNCATE: TRUNCATE gives every table a new file that the next checkpoint must
// fsync, which cost the next run's first DROP DATABASE about 87 s (S2, #336).
// The identities restart at 1 except the two restored tables, which continue after
// their last migrated row, as the migration left them.
const RESET_SQL = `
set local session_replication_role = replica;
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename not like '%drizzle%' loop
    execute format('delete from public.%I', r.tablename);
  end loop;
  for r in select sequencename from pg_sequences where schemaname = 'public' loop
    execute format('select setval(%L, 1, false)', 'public.' || r.sequencename);
  end loop;
end $$;
insert into public.categories select * from ${FIXTURE_SCHEMA}.categories;
insert into public.vehicles select * from ${FIXTURE_SCHEMA}.vehicles;
select setval(pg_get_serial_sequence('public.categories', 'id'), (select max(id) from public.categories));
select setval(pg_get_serial_sequence('public.vehicles', 'id'), (select max(id) from public.vehicles));`;

/**
 * Brings the worker's database back to the migrated state: every table in
 * schema `public` empty except the fixed category tree (ids 1-6) and the vehicle
 * list (ids 1-50, none retired), which are copied back from the template's
 * snapshot, and every identity restarted (the next category is 7, the next
 * vehicle 51, every other table starts at 1). Drizzle's own migrations table
 * lives in schema `drizzle` and is left alone. Integration files call this in
 * `beforeEach`; `reset-database.test.ts` pins the post-state.
 */
export async function resetDatabase(): Promise<void> {
  await assertTestDatabase();
  await getDb().$client.query(RESET_SQL);
}
