import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { sql } from 'drizzle-orm';
import { expect } from 'vitest';

import { getDb } from '@/db/client';
import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';

import { defaultCategoryId, insertCategory, insertFeed, insertShop, vehicleIdBySlug } from './catalogue';
import { assertTestDatabase } from './db';

// Data sets at the scale the cost tests need, shared by the gate's counting tests
// (tests/integration/category-fit-cost.test.ts, sitemap-performance.test.ts) and
// the timing tests (tests/timing/, `npm run test:timing`), so the two always
// measure the same rows (no-clock-in-gate S-1). Each seed ends with
// `vacuum (analyze)` of the tables it fills: it sets the visibility map and the
// statistics before anything is measured, so autovacuum cannot change a plan
// halfway through a test.

export const FIT_COST_PRODUCTS = 5000;
export const FIT_COST_BRANDS = 10;
/** The slug of the brand whose products the "one brand" calls list (Marca 3). */
export const FIT_COST_BRAND = 'marca-3';
export const FIT_COST_SLUG = 'cinco-mil';

/**
 * S5.8 AC 43: 5,000 public products in one leaf category `cinco-mil`, ten brands,
 * two offers each from two approved feeds, prices spread over 5 to 95 euros. One
 * third fit the car (the car and seven others), one third fit only other
 * vehicles (so they are no-fit), one third have no fitment. Returns the car's
 * vehicle id. The test database must be this worker's own.
 */
export async function seedFitCostCategory(): Promise<{ slug: 'cinco-mil'; carId: number; products: 5000 }> {
  await assertTestDatabase();
  const db = getDb();
  const category = await insertCategory({ slug: FIT_COST_SLUG });
  const feedA = await insertFeed((await insertShop()).id);
  const feedB = await insertFeed((await insertShop()).id);

  const carId = await vehicleIdBySlug(VEHICLE_CATALOGUE[0].slug);
  const otherRows = await db.execute<{ id: number }>(sql`select id from vehicles where id <> ${carId} order by id`);
  const others = otherRows.rows.map((row) => Number(row.id));
  expect(others.length).toBeGreaterThanOrEqual(40);
  const othersArray = sql.raw(`array[${others.join(',')}]`);
  const n = others.length;

  await db.execute(sql`
    insert into products (slug, title, brand, brand_normalised, category_id)
    select 'costo-' || g,
           'Producto ' || lpad(((g * 7919) % ${FIT_COST_PRODUCTS})::text, 5, '0'),
           'Marca ' || (g % ${FIT_COST_BRANDS}),
           'MARCA ' || (g % ${FIT_COST_BRANDS}),
           ${category.id}
    from generate_series(1, ${FIT_COST_PRODUCTS}) as g
  `);
  await db.execute(sql`
    insert into offers (product_id, feed_id, external_id, price_cents, url, price_updated_at)
    select p.id, f.feed_id, 'e-' || p.id || '-' || f.feed_id, 500 + ((p.id * 37 + f.feed_id * 11) % 9000),
           'https://affiliate.example/never-public', now()
    from products p cross join (values (${feedA}::int), (${feedB}::int)) as f(feed_id)
  `);
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
  await db.execute(sql`vacuum (analyze) products`);
  await db.execute(sql`vacuum (analyze) offers`);
  await db.execute(sql`vacuum (analyze) fitments`);

  return { slug: FIT_COST_SLUG, carId, products: FIT_COST_PRODUCTS };
}

/**
 * S6.2: `count` public products `perf-<n>` in the default category, one offer
 * each (1000 cents, an approved feed), so the sitemap lists every one of them.
 * The test database must be this worker's own.
 */
export async function seedSitemapProducts(count: number): Promise<void> {
  await assertTestDatabase();
  const db = getDb();
  const categoryId = await defaultCategoryId();
  const feedId = await insertFeed((await insertShop()).id);

  await db.execute(sql`
    insert into products (slug, title, category_id)
    select 'perf-' || g, 'Producto ' || g, ${categoryId} from generate_series(1, ${count}) as g
  `);
  await db.execute(sql`
    insert into offers (product_id, feed_id, external_id, price_cents, url, price_updated_at)
    select id, ${feedId}, 'e-' || id, 1000, 'https://affiliate.example/never-public', now() from products
  `);
  await db.execute(sql`vacuum (analyze) products`);
  await db.execute(sql`vacuum (analyze) offers`);
}

// Timing output (tests/timing/). A table is printed and written before any
// assertion, so a failing run still leaves its numbers.

/** The median of an odd or even count of samples (the upper middle one for an even count). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The header every timing table starts with:
 * `cpus=<n> integrationWorkers=<n> label=<TIMING_LABEL or local> <select version()>`.
 */
export async function timingHeader(): Promise<string> {
  // vitest.config.mts is outside tests/, and TypeScript cannot resolve a `.mts`
  // path without allowImportingTsExtensions: a computed specifier loads it.
  const config = path.resolve(process.cwd(), 'vitest.config.mts');
  const { integrationWorkers } = (await import(/* @vite-ignore */ pathToFileURL(config).href)) as {
    integrationWorkers: () => number;
  };
  const version = await getDb().execute<{ version: string }>(sql`select version() as version`);
  const label = process.env.TIMING_LABEL?.trim() || 'local';
  return `cpus=${availableParallelism()} integrationWorkers=${integrationWorkers()} label=${label} ${version.rows[0]?.version ?? 'unknown'}`;
}

/** Prints `lines` and writes them to `timing-results/<name>.md` at the repo root (git-ignored, docker-ignored). */
export function writeTimingReport(name: string, lines: string[]): void {
  const text = `${lines.join('\n')}\n`;
  const folder = path.resolve(process.cwd(), 'timing-results');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, `${name}.md`), text, 'utf8');
  console.log(`\n${text}`);
}
