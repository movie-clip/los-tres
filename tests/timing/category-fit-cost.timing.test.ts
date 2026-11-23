import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb } from '@/db/client';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import type { CategorySort } from '@/server/catalogue/category-query';

import { resetDatabase } from '../support/db';
import {
  FIT_COST_BRAND,
  FIT_COST_BRANDS,
  FIT_COST_PRODUCTS,
  median,
  seedFitCostCategory,
  timingHeader,
  writeTimingReport,
} from '../support/scale-fixtures';

// S5.8 AC 43 and 05-design § Cost measurement: what the car-filtered category
// listing costs in milliseconds on a category of 5,000 public products, against
// the same listing without a car. Run by `npm run test:timing` (one worker, on
// demand); the gate does not run it and asserts no time (no-clock-in-gate, S-1).
// The table is printed and written to timing-results/ before any assertion, so a
// failing run still shows its numbers. The only assertion is D-11's generous
// regression ceiling on the median of RUNS warm calls; the proposed pass
// threshold (every median with a car <= 250 ms and <= 3x the no-car median of
// the same call) is printed per row and is the human's to accept.

const RUNS = 5;
const CEILING_MS = 3000;
const THRESHOLD_MS = 250;
const THRESHOLD_RATIO = 3;

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

async function timed(call: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await call();
  return performance.now() - started;
}

describe('the filtered category listing on 5,000 products (AC 43), timed', () => {
  it('measures page 1 and the last page, two sorts, with and without a brand, with and without a car', async () => {
    const { slug, carId } = await seedFitCostCategory();

    type Row = {
      label: string;
      samplesWithout: number[];
      samplesWith: number[];
      without: number;
      withCar: number;
      ratio: number;
      met: boolean;
    };
    const rows: Row[] = [];
    const sorts: CategorySort[] = ['price-asc', 'name'];
    const brands: (string | null)[] = [null, FIT_COST_BRAND];

    for (const sort of sorts) {
      for (const brand of brands) {
        const lastWithout = (await getPublicCategoryPage(slug, 1, brand, sort))?.pageCount ?? 1;
        const lastWith = (await getPublicCategoryPage(slug, 1, brand, sort, carId))?.pageCount ?? 1;
        for (const position of ['page 1', 'last page'] as const) {
          const pageWithout = position === 'page 1' ? 1 : lastWithout;
          const pageWith = position === 'page 1' ? 1 : lastWith;
          const samplesWithout: number[] = [];
          const samplesWith: number[] = [];
          // One warm-up call each, then RUNS timed calls.
          await getPublicCategoryPage(slug, pageWithout, brand, sort);
          await getPublicCategoryPage(slug, pageWith, brand, sort, carId);
          for (let run = 0; run < RUNS; run += 1) {
            samplesWithout.push(await timed(() => getPublicCategoryPage(slug, pageWithout, brand, sort)));
            samplesWith.push(await timed(() => getPublicCategoryPage(slug, pageWith, brand, sort, carId)));
          }
          const without = median(samplesWithout);
          const withCar = median(samplesWith);
          const ratio = withCar / without;
          rows.push({
            label: `${position}, ${sort}, ${brand === null ? 'no brand' : 'one brand'}`,
            samplesWithout,
            samplesWith,
            without,
            withCar,
            ratio,
            met: withCar <= THRESHOLD_MS && ratio <= THRESHOLD_RATIO,
          });
        }
      }
    }

    const ms = (value: number, width: number): string => value.toFixed(1).padStart(width);
    const width = Math.max(...rows.map((row) => row.label.length));
    const first = rows[0];
    const lines = [
      await timingHeader(),
      '',
      `category-fit-cost: ${FIT_COST_PRODUCTS} public products, ${FIT_COST_BRANDS} brands, 2 offers each, median and max of ${RUNS} warm calls (ms)`,
      '',
      `${'call'.padEnd(width)} | no car median | no car max | with car median | with car max | ratio | threshold (<= ${THRESHOLD_MS} ms and <= ${THRESHOLD_RATIO}x)`,
      ...rows.map(
        (row) =>
          `${row.label.padEnd(width)} | ${ms(row.without, 13)} | ${ms(Math.max(...row.samplesWithout), 10)} | ${ms(row.withCar, 15)} | ${ms(Math.max(...row.samplesWith), 12)} | ${row.ratio.toFixed(2).padStart(5)} | ${row.met ? 'met' : 'NOT MET'}`,
      ),
      '',
      `raw samples of the first row (${first.label}), in call order: no car ${first.samplesWithout.map((v) => v.toFixed(1)).join(', ')}; with car ${first.samplesWith.map((v) => v.toFixed(1)).join(', ')}`,
    ];
    writeTimingReport('category-fit-cost', lines);

    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.without, `${row.label}, no car, median`).toBeLessThan(CEILING_MS);
      expect(row.withCar, `${row.label}, with car, median`).toBeLessThan(CEILING_MS);
    }
  }, 600000);
});
