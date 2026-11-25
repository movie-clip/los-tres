import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/db/client';
import type { offers } from '@/db/schema';
import { listSourcesForAdmin } from '@/server/admin/sources';

import { insertCollectedFeed, insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { stubLocalFlag } from '../support/local-flag';
import { captureQueries } from '../support/query-count';

// US-2.6 (T-2.6.3b), AC 30: the number of reads of the /admin/tiendas list does not grow with the number of
// shops, feeds or offers. A count of round trips, never a time, in the pattern of category-fit-cost and
// sitemap-performance: what the machine's speed cannot change. Both counts come from the one feeds read.

beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

let serial = 0;
async function offerOn(feedId: number, spec: Partial<typeof offers.$inferInsert> = {}) {
  serial += 1;
  const product = await insertProduct({ slug: `coste-${serial}` });
  await insertOffer({ productId: product.id, feedId, ...spec });
}

describe('listSourcesForAdmin makes the same reads for one shop and for many (AC 30)', () => {
  it.each(['off', 'on'] as const)('mode %s: two reads for one shop with one feed, and two for six shops with eighteen feeds and their offers', async (mode) => {
    stubLocalFlag(mode);

    const shop = await insertShop();
    await offerOn(await insertFeed(shop.id));
    const small = await captureQueries(() => listSourcesForAdmin());
    expect(small.result).toHaveLength(1);
    expect(small.result[0]).toMatchObject({ offerCount: 1, onSiteOfferCount: 1 });

    // Five more shops of three feeds each, with offers in every state the counts tell apart.
    for (let index = 0; index < 5; index += 1) {
      const next = await insertShop({ isApproved: index % 2 === 0 });
      for (let feedIndex = 0; feedIndex < 3; feedIndex += 1) {
        const feedId = await insertFeed(next.id, { isApproved: feedIndex !== 1 });
        await offerOn(feedId);
        await offerOn(feedId, { isHidden: true });
        await offerOn(feedId, { isRemoved: true });
        await offerOn(feedId, { inReview: true });
      }
    }
    const collected = await insertCollectedFeed();
    await offerOn(collected.feedId);

    const many = await captureQueries(() => listSourcesForAdmin());

    // Not vacuous: the read really covered many shops, feeds and offers, in more than one state.
    expect(many.result.length).toBeGreaterThanOrEqual(7);
    expect(many.result.flatMap((row) => row.feeds).length).toBeGreaterThanOrEqual(17);
    expect(many.result.reduce((sum, row) => sum + row.offerCount, 0)).toBeGreaterThan(small.result[0].offerCount);
    expect(many.result.some((row) => row.onSiteOfferCount > 0)).toBe(true);
    expect(many.result.some((row) => row.onSiteOfferCount < row.offerCount)).toBe(true);

    expect(many.queries.length).toBe(small.queries.length);
    expect(many.queries.length).toBe(2);
  });
});
