import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import type { CategorySort } from '@/server/catalogue/category-query';

import { insertCategory, insertFeed, insertShop, vehicleIdBySlug } from '../support/catalogue';
import { assertTestDatabase, resetDatabase } from '../support/db';

// S5.8 AC 43 and 05-design § Cost measurement: what the car-filtered category
// listing costs on a category of 5,000 public products, against the same listing
// without a car. The table of medians goes to stdout and the test lane copies it
// into its report. The only assertion on time is a generous regression ceiling
// (wall clock is noisy); the proposed pass threshold (every median with a car
// <= 250 ms and <= 3x the no-car median of the same call) is printed per row and
// is the human's to accept, so it does not fail the run.

const PRODUCTS = 5000;
const BRANDS = 10;
const RUNS = 5;
const CEILING_MS = 3000;
const THRESHOLD_MS = 250;
const THRESHOLD_RATIO = 3;
const SELECTED_BRAND = 'marca-3';

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function timed(call: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await call();
  return performance.now() - started;
}

describe('the filtered category listing on 5,000 products (AC 43)', () => {
  it('measures page 1 and the last page, two sorts, with and without a brand, with and without a car', async () => {
    await assertTestDatabase();
    const db = getDb();
    const category = await insertCategory({ slug: 'cinco-mil' });
    const feedA = await insertFeed((await insertShop()).id);
    const feedB = await insertFeed((await insertShop()).id);

    const carId = await vehicleIdBySlug(VEHICLE_CATALOGUE[0].slug);
    const otherRows = await db.execute<{ id: number }>(sql`select id from vehicles where id <> ${carId} order by id`);
    const others = otherRows.rows.map((row) => Number(row.id));
    expect(others.length).toBeGreaterThanOrEqual(40);
    const othersArray = sql.raw(`array[${others.join(',')}]`);
    const n = others.length;

    // 5,000 public products in one leaf category, ten brands, prices spread over 5 to 95 euros.
    await db.execute(sql`
      insert into products (slug, title, brand, brand_normalised, category_id)
      select 'costo-' || g,
             'Producto ' || lpad(((g * 7919) % ${PRODUCTS})::text, 5, '0'),
             'Marca ' || (g % ${BRANDS}),
             'MARCA ' || (g % ${BRANDS}),
             ${category.id}
      from generate_series(1, ${PRODUCTS}) as g
    `);
    // Two offers each, from two approved feeds.
    await db.execute(sql`
      insert into offers (product_id, feed_id, external_id, price_cents, url, price_updated_at)
      select p.id, f.feed_id, 'e-' || p.id || '-' || f.feed_id, 500 + ((p.id * 37 + f.feed_id * 11) % 9000),
             'https://affiliate.example/never-public', now()
      from products p cross join (values (${feedA}::int), (${feedB}::int)) as f(feed_id)
    `);
    // One third fit the car (the car and seven others), one third fit only other
    // vehicles (eight others, so they are no-fit), one third have no fitment.
    await db.execute(sql`
      insert into fitments (product_id, vehicle_id, feed_id)
      select p.id, ${carId}::int, ${feedA}::int from products p where p.id % 3 = 0
    `);
    await db.execute(sql`
      insert into fitments (product_id, vehicle_id, feed_id)
      select p.id, (${othersArray})[1 + ((p.id + k) % ${n}::int)], ${feedA}::int
      from products p, generate_series(1, 8) as k
      where p.id % 3 = 1 or (p.id % 3 = 0 and k <= 7)
    `);
    await db.execute(sql`analyze products`);
    await db.execute(sql`analyze offers`);
    await db.execute(sql`analyze fitments`);

    // The data is what the plan says it is: the three counts are the thirds.
    const probe = await getPublicCategoryPage('cinco-mil', 1, null, 'price-asc', carId);
    const noCar = await getPublicCategoryPage('cinco-mil', 1, null, 'price-asc');
    expect(noCar?.productCount).toBe(PRODUCTS);
    expect(probe?.fit).not.toBeNull();
    expect((probe?.fit?.fitsCount ?? 0) + (probe?.fit?.unknownCount ?? 0) + (probe?.fit?.leftOutCount ?? 0)).toBe(PRODUCTS);
    expect(probe?.fit?.fitsCount).toBeGreaterThan(1600);
    expect(probe?.fit?.leftOutCount).toBeGreaterThan(1600);
    expect(probe?.fit?.unknownCount).toBeGreaterThan(1600);

    type Row = {
      label: string;
      without: number;
      withCar: number;
      ratio: number;
      met: boolean;
    };
    const rows: Row[] = [];
    const sorts: CategorySort[] = ['price-asc', 'name'];
    const brands: (string | null)[] = [null, SELECTED_BRAND];

    for (const sort of sorts) {
      for (const brand of brands) {
        const lastWithout = (await getPublicCategoryPage('cinco-mil', 1, brand, sort))?.pageCount ?? 1;
        const lastWith = (await getPublicCategoryPage('cinco-mil', 1, brand, sort, carId))?.pageCount ?? 1;
        for (const position of ['page 1', 'last page'] as const) {
          const pageWithout = position === 'page 1' ? 1 : lastWithout;
          const pageWith = position === 'page 1' ? 1 : lastWith;
          const samples = { without: [] as number[], withCar: [] as number[] };
          // One warm-up call each, then RUNS timed calls.
          await getPublicCategoryPage('cinco-mil', pageWithout, brand, sort);
          await getPublicCategoryPage('cinco-mil', pageWith, brand, sort, carId);
          for (let run = 0; run < RUNS; run += 1) {
            samples.without.push(await timed(() => getPublicCategoryPage('cinco-mil', pageWithout, brand, sort)));
            samples.withCar.push(await timed(() => getPublicCategoryPage('cinco-mil', pageWith, brand, sort, carId)));
          }
          const without = median(samples.without);
          const withCar = median(samples.withCar);
          const ratio = withCar / without;
          rows.push({
            label: `${position}, ${sort}, ${brand === null ? 'no brand' : 'one brand'}`,
            without,
            withCar,
            ratio,
            met: withCar <= THRESHOLD_MS && ratio <= THRESHOLD_RATIO,
          });
          expect(Math.max(...samples.without, ...samples.withCar), rows.at(-1)?.label).toBeLessThan(CEILING_MS);
        }
      }
    }

    const width = Math.max(...rows.map((row) => row.label.length));
    const lines = [
      '',
      `category-fit-cost: ${PRODUCTS} public products, ${BRANDS} brands, 2 offers each, median of ${RUNS} warm calls (ms)`,
      `${'call'.padEnd(width)} | no car | with car | ratio | threshold (<= ${THRESHOLD_MS} ms and <= ${THRESHOLD_RATIO}x)`,
      ...rows.map(
        (row) =>
          `${row.label.padEnd(width)} | ${row.without.toFixed(1).padStart(6)} | ${row.withCar.toFixed(1).padStart(8)} | ${row.ratio.toFixed(2).padStart(5)} | ${row.met ? 'met' : 'NOT MET'}`,
      ),
      '',
    ];
    console.log(lines.join('\n'));

    expect(rows).toHaveLength(8);
  }, 600000);
});
