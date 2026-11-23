import { Client } from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import {
  adminAccounts,
  adminSessions,
  adminUsers,
  adminVerifications,
  clicks,
  networks,
} from '@/db/schema';

import {
  insertCategory,
  insertCategoryMapping,
  insertFeed,
  insertFitment,
  insertListedProduct,
  insertShop,
  insertVehicle,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { baseDatabaseName, templateDatabaseName, withDatabaseName } from '../support/env';

vi.setConfig({ testTimeout: 30_000 });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

// The post-state contract of `resetDatabase` (S3, #337): every public table is
// empty except the fixed categories and the vehicle list as the migration left
// them, every identity is back where the migration left it, and the `drizzle`
// schema is untouched. The reference is the migrated template this worker's
// database was cloned from: `runMigrations` made it from nothing and nothing
// ever writes to it, so it is "a fresh migrated state" with no copy of the tree
// or the list in this file.

type Queryable = { query: (text: string) => Promise<{ rows: Record<string, unknown>[] }> };

type Fingerprint = {
  /** `schema.table` to its rows as JSON, in a stable order. */
  tables: Record<string, unknown>;
  /** `schema.sequence` to the value its next `nextval` returns. */
  nextValues: Record<string, unknown>;
};

async function fingerprintOf(db: Queryable): Promise<Fingerprint> {
  const names = await db.query(
    `select schemaname, tablename from pg_tables where schemaname in ('public', 'drizzle') order by 1, 2`,
  );
  const tables: Record<string, unknown> = {};
  for (const { schemaname, tablename } of names.rows) {
    const result = await db.query(
      `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as rows
         from "${String(schemaname)}"."${String(tablename)}" t`,
    );
    tables[`${String(schemaname)}.${String(tablename)}`] = result.rows[0].rows;
  }
  const sequences = await db.query(
    `select schemaname || '.' || sequencename as name, coalesce(last_value + increment_by, start_value)::text as next
       from pg_sequences where schemaname in ('public', 'drizzle') order by 1`,
  );
  const nextValues: Record<string, unknown> = {};
  for (const row of sequences.rows) {
    nextValues[String(row.name)] = row.next;
  }
  return { tables, nextValues };
}

async function freshMigratedState(): Promise<Fingerprint> {
  const url = process.env.DATABASE_URL ?? '';
  const template = templateDatabaseName(baseDatabaseName(url));
  const client = new Client({ connectionString: withDatabaseName(url, template) });
  await client.connect();
  try {
    return await fingerprintOf(client);
  } finally {
    await client.end();
  }
}

const workerFingerprint = () => fingerprintOf(getDb().$client);

const rowsOf = (fingerprint: Fingerprint, table: string): unknown[] => fingerprint.tables[table] as unknown[];

/** Writes at least one row into every public table, moves every identity and edits the fixed rows. */
async function dirtyEveryTable(): Promise<void> {
  const db = getDb();
  const product = await insertListedProduct({ slug: 'reset-a', prices: [1000, 1500] });
  const category = await insertCategory({ slug: 'reset-categoria', name: 'Reset' });
  const shop = await insertShop();
  const feedId = await insertFeed(shop.id);
  await insertCategoryMapping(feedId, 'reset', category.id);
  const vehicle = await insertVehicle();
  await insertFitment(product.id, vehicle.id, feedId);
  await db.insert(networks).values({ name: 'Red', slug: 'reset-red' });
  await db.insert(clicks).values({ offerId: product.offerIds[0], shopId: shop.id, productId: product.id });
  await db.insert(adminUsers).values({ id: 'reset-user', name: 'admin', email: 'reset@example.test' });
  await db.insert(adminAccounts).values({
    id: 'reset-account',
    accountId: 'reset-user',
    providerId: 'credential',
    userId: 'reset-user',
  });
  await db.insert(adminSessions).values({
    id: 'reset-session',
    token: 'reset-token',
    userId: 'reset-user',
    expiresAt: new Date(0),
  });
  await db.insert(adminVerifications).values({
    id: 'reset-verification',
    identifier: 'reset',
    value: 'reset',
    expiresAt: new Date(0),
  });
  // The fixed rows are edited in place, not only added to.
  await db.$client.query(`update public.categories set name = 'editada', position = 99 where id = 2`);
  await db.$client.query(`update public.vehicles set is_retired = true, position = 99999 where id = 3`);
  await db.$client.query(`delete from public.vehicles where id = 4`);
}

describe('the reference state (the migrated template)', () => {
  it('holds the fixed categories and the vehicle list and nothing else, with identities after them', async () => {
    const fresh = await freshMigratedState();
    expect(rowsOf(fresh, 'public.categories')).toHaveLength(6);
    expect(rowsOf(fresh, 'public.vehicles')).toHaveLength(50);
    const others = Object.keys(fresh.tables).filter(
      (name) => name.startsWith('public.') && !['public.categories', 'public.vehicles'].includes(name),
    );
    expect(others.length).toBeGreaterThan(10);
    for (const name of others) {
      expect(rowsOf(fresh, name), name).toEqual([]);
    }
    expect(fresh.nextValues['public.categories_id_seq']).toBe('7');
    expect(fresh.nextValues['public.vehicles_id_seq']).toBe('51');
    expect(fresh.nextValues['public.products_id_seq']).toBe('1');
    expect(rowsOf(fresh, 'drizzle.__drizzle_migrations').length).toBeGreaterThan(0);
  });
});

describe('resetDatabase post-state', () => {
  it('a database dirtied in every table, the fixed rows included, is the migrated state again', async () => {
    const fresh = await freshMigratedState();
    await dirtyEveryTable();

    // Non-vacuity: the dirtying reached every public table, so a table added later
    // that this helper does not fill fails here instead of passing unchecked.
    const dirty = await workerFingerprint();
    for (const name of Object.keys(dirty.tables).filter((table) => table.startsWith('public.'))) {
      expect(rowsOf(dirty, name).length, `${name} was dirtied`).toBeGreaterThan(
        name === 'public.categories' ? 6 : name === 'public.vehicles' ? 49 : 0,
      );
    }
    expect(dirty).not.toEqual(fresh);

    await resetDatabase();
    expect(await workerFingerprint()).toEqual(fresh);
  });

  it('restores an edited fixed category and an edited, retired and deleted vehicle', async () => {
    const fresh = await freshMigratedState();
    await dirtyEveryTable();
    await resetDatabase();
    const after = await workerFingerprint();
    expect(rowsOf(after, 'public.categories')).toEqual(rowsOf(fresh, 'public.categories'));
    expect(rowsOf(after, 'public.vehicles')).toEqual(rowsOf(fresh, 'public.vehicles'));
  });

  it('restarts every identity where the migration left it, so the next rows take ids 7 and 51', async () => {
    await dirtyEveryTable();
    await resetDatabase();
    const category = await insertCategory({ slug: 'reset-siguiente' });
    const vehicle = await insertVehicle();
    expect(category.id).toBe(7);
    expect(vehicle.id).toBe(51);
    const shop = await insertShop();
    expect(shop.id).toBe(1);
  });

  it('leaves the drizzle schema untouched', async () => {
    const before = (await workerFingerprint()).tables['drizzle.__drizzle_migrations'];
    await dirtyEveryTable();
    await resetDatabase();
    const after = (await workerFingerprint()).tables['drizzle.__drizzle_migrations'];
    expect(after).toEqual(before);
    expect(after as unknown[]).not.toHaveLength(0);
  });

  it('is the same from a database that is already clean, and when called twice', async () => {
    const fresh = await freshMigratedState();
    await resetDatabase();
    expect(await workerFingerprint()).toEqual(fresh);
    await resetDatabase();
    expect(await workerFingerprint()).toEqual(fresh);
  });

  it('leaves the schema alone: the public tables are the same set before and after', async () => {
    const names = async () =>
      (await getDb().$client.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows;
    const before = await names();
    await dirtyEveryTable();
    await resetDatabase();
    expect(await names()).toEqual(before);
  });
});

describe('resetDatabase refusal', () => {
  it('checks the database first: on a pool id that is not its own it throws and writes nothing', async () => {
    const own = Number(process.env.VITEST_POOL_ID);
    const sentinel = await insertShop({ slug: 'reset-sentinel' });
    vi.stubEnv('VITEST_POOL_ID', String(own + 1));
    try {
      await expect(resetDatabase()).rejects.toThrow(/Refusing to run/);
    } finally {
      vi.unstubAllEnvs();
    }
    const rows = await getDb().$client.query(`select id from public.shops where slug = 'reset-sentinel'`);
    expect(rows.rows).toEqual([{ id: sentinel.id }]);
  });
});
