import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';

import { assertTestDatabase } from '../support/db';

afterAll(async () => {
  await closeDb();
});

describe('database client (C-4)', () => {
  it('runs select 1 against the real database', async () => {
    const result = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
    expect(result.rows[0]?.ok).toBe(1);
  });

  it('is connected to a _test database', async () => {
    const result = await getDb().execute<{ name: string }>(sql`select current_database() as name`);
    expect(result.rows[0]?.name.endsWith('_test')).toBe(true);
    await expect(assertTestDatabase()).resolves.toBeUndefined();
  });

  it('caches the instance until closeDb, then reconnects', async () => {
    const first = getDb();
    expect(getDb()).toBe(first);
    await closeDb();
    const second = getDb();
    expect(second).not.toBe(first);
    const result = await second.execute<{ ok: number }>(sql`select 1 as ok`);
    expect(result.rows[0]?.ok).toBe(1);
  });
});
