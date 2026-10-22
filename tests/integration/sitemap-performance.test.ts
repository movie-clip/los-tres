import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as getIndex } from '@/app/(public)/sitemap.xml/route';
import { GET as getFile } from '@/app/(public)/sitemaps/[file]/route';
import { closeDb, getDb } from '@/db/client';
import { SITEMAP_CHUNK_SIZE } from '@/server/catalogue/sitemap';

import { defaultCategoryId, insertFeed, insertShop } from '../support/catalogue';
import { assertTestDatabase, resetDatabase } from '../support/db';

// S6.2 design: the sitemap is generated per request, with no index and no
// cache, so 10,000 public products must stay cheap. Wall clock is noisy on a
// slow machine, so the budget is generous: the real cost is milliseconds.

const PRODUCTS = 10000;
const BUDGET_MS = 3000;

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

describe('sitemap generation at scale', () => {
  it('generates the index, every product chunk and the page sitemap for 10,000 products within the budget', async () => {
    await assertTestDatabase();
    const db = getDb();
    const categoryId = await defaultCategoryId();
    const feedId = await insertFeed((await insertShop()).id);

    await db.execute(sql`
      insert into products (slug, title, category_id)
      select 'perf-' || g, 'Producto ' || g, ${categoryId} from generate_series(1, ${PRODUCTS}) as g
    `);
    await db.execute(sql`
      insert into offers (product_id, feed_id, external_id, price_cents, url, price_updated_at)
      select id, ${feedId}, 'e-' || id, 1000, 'https://affiliate.example/never-public', now() from products
    `);
    await db.execute(sql`analyze products`);
    await db.execute(sql`analyze offers`);

    const started = performance.now();
    const index = await getIndex();
    const indexBody = await index.text();
    const files = [...indexBody.matchAll(/<loc>[^<]*\/sitemaps\/([^<]+)<\/loc>/g)].map((m) => m[1]);
    const bodies: string[] = [];
    for (const file of files) {
      const response = await getFile(new Request(`http://127.0.0.1:3000/sitemaps/${file}`), {
        params: Promise.resolve({ file }),
      });
      expect(response.status).toBe(200);
      bodies.push(await response.text());
    }
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(BUDGET_MS);

    // Chunking is live: 10,000 products over chunks of SITEMAP_CHUNK_SIZE.
    const chunks = Math.ceil(PRODUCTS / SITEMAP_CHUNK_SIZE);
    expect(chunks).toBeGreaterThanOrEqual(2);
    expect(files).toEqual(['paginas.xml', ...Array.from({ length: chunks }, (_, i) => `productos-${i + 1}.xml`)]);

    const productLocs = bodies.flatMap((body) => [...body.matchAll(/\/producto\/(perf-\d+)</g)].map((m) => m[1]));
    expect(productLocs).toHaveLength(PRODUCTS);
    expect(new Set(productLocs).size).toBe(PRODUCTS);
    for (const body of bodies.slice(1)) {
      expect((body.match(/<url>/g) ?? []).length).toBeLessThanOrEqual(SITEMAP_CHUNK_SIZE);
    }
  }, 60000);
});
