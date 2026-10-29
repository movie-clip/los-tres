import { readFileSync } from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';

import { resetDatabase } from '../support/db';

beforeEach(resetDatabase);
afterAll(closeDb);

// Migration 0005_search runs once per database, and the test database already
// applied it on an empty schema. As fixed-category-tree.test.ts does for 0004,
// its statements are run here again against a legacy row: inside a transaction
// that first removes what 0005 added, so the "before" state is real, and that
// is rolled back at the end so no other test sees the change.

const statements = readFileSync(path.resolve(process.cwd(), 'src/db/migrations/0005_search.sql'), 'utf8')
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

class Rollback extends Error {}

async function withinRolledBackTransaction(body: (run: (text: string) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<void>) {
  await expect(
    getDb().transaction(async (tx) => {
      const run = (text: string) => tx.execute(sql.raw(text)) as Promise<{ rows: Record<string, unknown>[] }>;
      await body(run);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

/** The schema as it was before 0005: no search column, no search functions, no search configurations. */
async function revertToBefore0005(run: (text: string) => Promise<unknown>) {
  await run('alter table products drop column search_vector');
  await run('drop index products_part_number_normalised_idx');
  await run('drop function public.search_text_query(text)');
  await run('drop function public.search_word_query(text)');
  await run('drop function public.search_fold_codes(text)');
  await run('drop text search configuration public.search_es');
  await run('drop text search configuration public.search_simple');
}

describe('migration 0005_search (S5.4, AC 12)', () => {
  it('the file carries the pieces the loader needs', () => {
    expect(statements.length).toBeGreaterThanOrEqual(8);
    const text = statements.join('\n');
    for (const piece of [
      'unaccent',
      'public.search_es',
      'public.search_simple',
      'public.search_fold_codes',
      'public.search_word_query',
      'public.search_text_query',
      'search_vector',
      'products_search_vector_idx',
      'products_part_number_normalised_idx',
    ]) {
      expect(text).toContain(piece);
    }
  });

  it('the migrated test database has the column, both indexes and the functions', async () => {
    const column = await getDb().execute<{ is_generated: string; data_type: string }>(
      sql`select is_generated, data_type from information_schema.columns
          where table_name = 'products' and column_name = 'search_vector'`,
    );
    expect(column.rows).toEqual([{ is_generated: 'ALWAYS', data_type: 'tsvector' }]);

    const indexes = await getDb().execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename = 'products'`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining(['products_search_vector_idx', 'products_part_number_normalised_idx']),
    );

    const functions = await getDb().execute<{ proname: string }>(
      sql`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and proname like 'search\_%'`,
    );
    expect(functions.rows.map((row) => row.proname).sort()).toEqual([
      'search_fold_codes',
      'search_text_query',
      'search_word_query',
    ]);
  });

  it('a product inserted before 0005 is found after it, with no other step', async () => {
    await withinRolledBackTransaction(async (run) => {
      await revertToBefore0005(run);
      const before = await run(
        `select count(*)::int as n from information_schema.columns where table_name = 'products' and column_name = 'search_vector'`,
      );
      expect(before.rows[0].n).toBe(0);

      await run(
        `insert into products (slug, title, brand) values
           ('legado-aceite', 'Aceite sintético 5W-30 4L', 'Castrol'),
           ('legado-filtro', 'Filtros de aire', null)`,
      );

      for (const statement of statements) await run(statement);

      const find = async (term: string) =>
        (await run(`select slug from products where search_vector @@ public.search_text_query('${term}') order by slug`)).rows.map(
          (row) => row.slug,
        );
      expect(await find('sintetico castrol')).toEqual(['legado-aceite']);
      expect(await find('5w30')).toEqual(['legado-aceite']);
      expect(await find('filtro')).toEqual(['legado-filtro']);
      expect(await find('zzzz')).toEqual([]);
    });
  });

  it('the rolled-back transactions above left the migrated schema in place', async () => {
    const found = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from pg_proc where proname = 'search_text_query'`,
    );
    expect(found.rows[0].n).toBe(1);
  });
});
