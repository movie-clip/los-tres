import { readFileSync } from 'node:fs';
import path from 'node:path';

import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';

afterAll(async () => {
  await closeDb();
});

const tables = Object.values(schema as Record<string, unknown>).filter((value): value is PgTable => is(value, PgTable));

describe('migrations (TD-37)', () => {
  it('the global setup built the schema from nothing: every expected table exists', async () => {
    const result = await getDb().execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const present = result.rows.map((row) => row.tablename);
    expect(present).toEqual(
      expect.arrayContaining([
        'networks',
        'shops',
        'feeds',
        'categories',
        'products',
        'offers',
        'clicks',
        'feed_category_mappings',
        'admin_users',
        'admin_accounts',
        'admin_sessions',
        'admin_verifications',
      ]),
    );
  });

  it('every schema table is the one drizzle describes, and none is missing in the database', async () => {
    expect(tables.length).toBeGreaterThanOrEqual(6);
    const result = await getDb().execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const present = new Set(result.rows.map((row) => row.tablename));
    for (const table of tables) {
      expect(present.has(getTableConfig(table).name)).toBe(true);
    }
  });

  it('every schema column exists with matching nullability', async () => {
    const result = await getDb().execute<{
      table_name: string;
      column_name: string;
      is_nullable: 'YES' | 'NO';
    }>(
      sql`select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'`,
    );
    const actual = new Map(
      result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable === 'YES']),
    );
    for (const table of tables) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        const key = `${config.name}.${column.name}`;
        expect(actual.has(key), `${key} exists`).toBe(true);
        expect(actual.get(key), `${key} nullable`).toBe(!column.notNull);
      }
    }
  });

  it('applying the migrations again is a no-op', async () => {
    const count = async () => {
      const result = await getDb().execute<{ n: number }>(
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      );
      return result.rows[0].n;
    };
    const before = await count();
    await expect(runMigrations(getDb())).resolves.toBeUndefined();
    expect(await count()).toBe(before);
  });

  it('has applied every migration in the journal', async () => {
    const journal = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'src/db/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: unknown[] };
    const result = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(result.rows[0].n).toBe(journal.entries.length);
  });
});
