import { readFileSync } from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { products } from '@/db/schema';
import { selectByBrandPartNumber } from '@/server/matching';

import { allProducts } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { aFeedOf, EAN, importRows, keyRow, storedProduct } from '../support/matching';

// S7.1, ACs 25 and 26 (US-7.1, T7.1.2). Design D-B: no migration and no schema edit, the existing
// btree `products_part_number_normalised_idx` serves the lookup, and no uniqueness is added anywhere.

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

const INDEX = 'products_part_number_normalised_idx';
const KEY = { brandNormalised: 'MARCAUNO', partNumberNormalised: 'PN100' };

type PlanNode = { 'Node Type': string; 'Index Name'?: string; 'Relation Name'?: string; Plans?: PlanNode[] };

function nodesOf(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(nodesOf)];
}

/** Thrown to roll a transaction back after a test has read what it needed. */
class Rollback extends Error {}

/**
 * The plan of the step 2 lookup with sequential scans discouraged: on a small table the planner
 * reads the whole table whatever is indexed, so the plan only shows whether an index CAN serve it.
 * `inside` runs first in the same transaction (a DDL, which PostgreSQL rolls back with it).
 */
async function planOfLookup(inside: (tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]) => Promise<void> = async () => undefined) {
  let nodes: PlanNode[] = [];
  await getDb()
    .transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      for (let n = 0; n < 50; n += 1) {
        await tx.insert(products).values({
          slug: `relleno-${n}`,
          title: `Relleno ${n}`,
          brand: 'Marca',
          brandNormalised: 'MARCA',
          partNumber: `P ${n}`,
          partNumberNormalised: `P${n}`,
        });
      }
      await tx.execute(sql`analyze products`);
      await inside(tx);
      // The builder is the exact query matchProduct runs; EXPLAIN takes it with its parameters bound.
      const result = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        sql`explain (format json) ${selectByBrandPartNumber(tx, KEY)}`,
      );
      nodes = nodesOf(result.rows[0]['QUERY PLAN'][0].Plan);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return nodes;
}

describe('AC 25: the brand and part-number lookup is served by an index', () => {
  it('plans an index scan on products_part_number_normalised_idx and no sequential scan of products', async () => {
    const nodes = await planOfLookup();

    expect(nodes.some((node) => node['Index Name'] === INDEX)).toBe(true);
    expect(nodes.filter((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'products')).toEqual([]);
  });

  it('non-vacuity: with the index dropped the same lookup plans a sequential scan of products', async () => {
    const nodes = await planOfLookup(async (tx) => {
      await tx.execute(sql.raw(`drop index ${INDEX}`));
    });

    expect(nodes.some((node) => node['Index Name'] === INDEX)).toBe(false);
    expect(nodes.some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'products')).toBe(true);
  });

  it('the lookup that the plan explains is the one matchProduct calls', () => {
    // matchProduct and selectByBrandPartNumber share one module; step 2 must call the exported
    // builder, not a copy of it, or this plan test explains a query nobody runs.
    const source = readFileSync(path.resolve(process.cwd(), 'src/server/matching.ts'), 'utf8');
    expect(source.match(/selectByBrandPartNumber\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AC 26: two products with one key are safe', () => {
  /** Every unique index on products, by name. */
  async function uniqueIndexes(): Promise<string[]> {
    const result = await getDb().execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public' and tablename = 'products' and indexdef like 'CREATE UNIQUE%' order by indexname`,
    );
    return result.rows.map((row) => row.indexname);
  }

  it('no unique index covers the brand, part number or EAN columns', async () => {
    const result = await getDb().execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'products' and indexdef like 'CREATE UNIQUE%'`,
    );
    for (const row of result.rows) {
      expect(row.indexdef).not.toMatch(/brand_normalised|part_number_normalised|ean_normalised/);
    }
    expect(await uniqueIndexes()).toEqual(['products_pkey', 'products_slug_unique']);
  });

  it('a database holding two products with one key still migrates, twice, and keeps them both', async () => {
    await storedProduct({ slug: 'gemelo-1', brand: 'MarcaUno', part: 'PN 100' });
    await storedProduct({ slug: 'gemelo-2', brand: 'MarcaUno', part: 'PN 100' });

    await expect(runMigrations(getDb())).resolves.toBeUndefined();
    await expect(runMigrations(getDb())).resolves.toBeUndefined();

    const rows = await allProducts();
    expect(rows.map((row) => [row.slug, row.brandNormalised, row.partNumberNormalised])).toEqual([
      ['gemelo-1', 'MARCAUNO', 'PN100'],
      ['gemelo-2', 'MARCAUNO', 'PN100'],
    ]);
  });

  it('and still imports without error: the row becomes its own product, and an import after that is a no-op', async () => {
    await storedProduct({ slug: 'gemelo-1', brand: 'MarcaUno', part: 'PN 100' });
    await storedProduct({ slug: 'gemelo-2', brand: 'MarcaUno', part: 'PN 100' });
    await storedProduct({ slug: 'gemelo-3', ean: EAN.one });
    await storedProduct({ slug: 'gemelo-4', ean: EAN.one });
    const feed = await aFeedOf();
    const rows = [
      keyRow('x-1', { brand: 'MarcaUno', part: 'PN 100' }),
      keyRow('x-2', { brand: 'MarcaDos', part: 'PN 200', ean: EAN.one }),
    ];

    const first = await importRows({ [feed.feedId]: rows });
    const second = await importRows({ [feed.feedId]: rows });

    expect(first.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 2, offersCreated: 2, rejected: [] });
    expect(first.feeds[0].ownProducts.map((own) => own.reason)).toEqual(['ambiguous_brand_part_number', 'ambiguous_ean']);
    expect(second.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 0, offersCreated: 0, offersUpdated: 2 });
    expect(await allProducts()).toHaveLength(6);
  });
});
