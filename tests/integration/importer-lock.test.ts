import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { importFeeds } from '@/server/importer';
import type { FeedBytes } from '@/server/importer/types';

import { insertFeed, insertShop } from '../support/catalogue';
import { assertTestDatabase, resetDatabase } from '../support/db';

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

const CSV_HEADER = 'id,title,brand,part_number,ean,price,currency,url,description\n';
const CSV_ROW = 'L-1,Fixture Lock Filtro,MarcaUno,PN 900,2000000000900,10.00,EUR,https://shop-a.example/p/L-1,Descripcion\n';

/** SQLSTATE of a driver error, which drizzle may wrap in `cause`. */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** What a feed save does to the row: FOR NO KEY UPDATE, failing at once when it is held. */
async function tryFeedSaveLock(feedId: number): Promise<'free' | string> {
  try {
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`select id from feeds where id = ${feedId} for no key update nowait`);
    });
    return 'free';
  } catch (error) {
    return sqlState(error) ?? 'unknown';
  }
}

// S4.2, D-16: an import shares the feed row until its transaction ends, so an
// admin mapping save (FOR NO KEY UPDATE on the same row) cannot run in between.
describe('the importer holds FOR SHARE on its feed row (S4.2, D-16)', () => {
  it('blocks a FOR NO KEY UPDATE on the feed while it imports, and releases it at the end', async () => {
    await assertTestDatabase();
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id, { url: 'lock.csv' });

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let parkedNow: () => void = () => undefined;
    const parked = new Promise<void>((resolve) => {
      parkedNow = resolve;
    });
    // The header is read before the transaction opens; the row is pulled inside it.
    // The second pull is the importer asking for the row, so the transaction is
    // open and holds the feed row: the source says so, then waits on the gate.
    async function* source(): FeedBytes {
      yield new TextEncoder().encode(CSV_HEADER);
      parkedNow();
      await gate;
      yield new TextEncoder().encode(CSV_ROW);
    }

    const running = importFeeds(getDb(), { feedId, deps: { readSource: async () => source() } });
    try {
      // No clock and no poll (0006, rules 1 and 3): wait for the import to say it is
      // parked. An import that ends first never parks, so the race lets it fail the
      // assertion below instead of waiting for the test timeout.
      await Promise.race([parked, running]);
      expect(await tryFeedSaveLock(feedId), 'a save could take the feed row while the import was running').toBe(
        '55P03',
      );
      // Still held on a second try, not a passing blip.
      expect(await tryFeedSaveLock(feedId)).toBe('55P03');
    } finally {
      release();
    }

    const report = await running;
    expect(report.feeds[0]).toMatchObject({ feedId, outcome: 'imported' });
    expect(await tryFeedSaveLock(feedId)).toBe('free');
  });
});
