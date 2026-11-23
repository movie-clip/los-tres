import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb } from '@/db/client';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import type { CategorySort } from '@/server/catalogue/category-query';

import { resetDatabase } from '../support/db';
import { captureQueries } from '../support/query-count';
import { FIT_COST_BRAND, FIT_COST_PRODUCTS, seedFitCostCategory } from '../support/scale-fixtures';

// S5.8 AC 43 and 05-design § Cost measurement, as the gate sees it: what the
// car-filtered category listing costs on a category of 5,000 public products.
// The gate asserts no time (no-clock-in-gate, S-1): it checks the data the cost
// depends on and that every call stays within a ceiling of database round trips,
// which the speed of the machine cannot change. The timing table (medians with
// and without a car, the 3,000 ms ceiling) is tests/timing/
// category-fit-cost.timing.test.ts, run by `npm run test:timing`.

// A ceiling, not an exact number: a deliberate extra query is a change to this
// constant, a read per listed product is a failure. Measured today at the first
// build of this test: 6 with no car and no brand, 7 with a car or a brand.
const MAX_QUERIES_PER_CALL = 7;

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

describe('the filtered category listing on 5,000 products (AC 43)', () => {
  it('stays within the query ceiling on page 1 and the last page, two sorts, with and without a brand and a car', async () => {
    const { slug, carId } = await seedFitCostCategory();

    // The data is what the cost depends on: the three counts are the thirds.
    const probe = await getPublicCategoryPage(slug, 1, null, 'price-asc', carId);
    const noCar = await getPublicCategoryPage(slug, 1, null, 'price-asc');
    expect(noCar?.productCount).toBe(FIT_COST_PRODUCTS);
    expect(probe?.fit).not.toBeNull();
    expect((probe?.fit?.fitsCount ?? 0) + (probe?.fit?.unknownCount ?? 0) + (probe?.fit?.leftOutCount ?? 0)).toBe(
      FIT_COST_PRODUCTS,
    );
    expect(probe?.fit?.fitsCount).toBeGreaterThan(1600);
    expect(probe?.fit?.leftOutCount).toBeGreaterThan(1600);
    expect(probe?.fit?.unknownCount).toBeGreaterThan(1600);

    const sorts: CategorySort[] = ['price-asc', 'name'];
    const brands: (string | null)[] = [null, FIT_COST_BRAND];
    const cars: (number | null)[] = [null, carId];
    let calls = 0;

    for (const sort of sorts) {
      for (const brand of brands) {
        for (const car of cars) {
          const label = `${sort}, ${brand === null ? 'no brand' : 'one brand'}, ${car === null ? 'no car' : 'with car'}`;
          const last = (await getPublicCategoryPage(slug, 1, brand, sort, car))?.pageCount ?? 1;
          expect(last, label).toBeGreaterThan(1);
          const counts: number[] = [];
          for (const page of [1, last]) {
            const { result, queries } = await captureQueries(() => getPublicCategoryPage(slug, page, brand, sort, car));
            const call = `${label}, page ${page}`;
            // The call answers a real page, not an empty one that happens to be cheap.
            expect(result?.page, call).toBe(page);
            expect(result?.products.length, call).toBeGreaterThan(0);
            expect(queries.length, call).toBeGreaterThan(0);
            expect(queries.length, call).toBeLessThanOrEqual(MAX_QUERIES_PER_CALL);
            counts.push(queries.length);
            calls += 1;
          }
          // A cost that grows with the page number is a read per page.
          expect(counts[1], label).toBe(counts[0]);
        }
      }
    }

    // Two sorts x two brand states x two pages x with or without a car.
    expect(calls).toBe(16);
  }, 600000);
});
