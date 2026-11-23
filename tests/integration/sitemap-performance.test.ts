import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as getIndex } from '@/app/(public)/sitemap.xml/route';
import { GET as getFile } from '@/app/(public)/sitemaps/[file]/route';
import { closeDb } from '@/db/client';
import { SITEMAP_CHUNK_SIZE } from '@/server/catalogue/sitemap';

import { resetDatabase } from '../support/db';
import { captureQueries } from '../support/query-count';
import { seedSitemapProducts } from '../support/scale-fixtures';

// S6.2 design: the sitemap is generated per request, with no index and no
// cache, so 10,000 public products must stay cheap. The gate asserts no time
// (no-clock-in-gate, S-1): it checks the 10,000-product answer and that the
// whole sequence stays within a ceiling of database round trips, which the
// speed of the machine cannot change. The timing (median of 5 sequences, the
// 3,000 ms ceiling) is tests/timing/sitemap.timing.test.ts, run by
// `npm run test:timing`.

const PRODUCTS = 10000;

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

describe('sitemap generation at scale', () => {
  it('generates the index, every product chunk and the page sitemap for 10,000 products within the query ceiling', async () => {
    await seedSitemapProducts(PRODUCTS);

    const { result: bodies, queries } = await captureQueries(async () => {
      const index = await getIndex();
      const indexBody = await index.text();
      const files = [...indexBody.matchAll(/<loc>[^<]*\/sitemaps\/([^<]+)<\/loc>/g)].map((m) => m[1]);
      const answers: { file: string; body: string }[] = [{ file: 'index', body: indexBody }];
      for (const file of files) {
        const response = await getFile(new Request(`http://127.0.0.1:3000/sitemaps/${file}`), {
          params: Promise.resolve({ file }),
        });
        expect(response.status).toBe(200);
        answers.push({ file, body: await response.text() });
      }
      return answers;
    });

    // Chunking is live: 10,000 products over chunks of SITEMAP_CHUNK_SIZE.
    const chunks = Math.ceil(PRODUCTS / SITEMAP_CHUNK_SIZE);
    expect(chunks).toBeGreaterThanOrEqual(2);
    const files = bodies.slice(1).map((answer) => answer.file);
    expect(files).toEqual(['paginas.xml', ...Array.from({ length: chunks }, (_, i) => `productos-${i + 1}.xml`)]);

    const productBodies = bodies.slice(2).map((answer) => answer.body);
    const productLocs = productBodies.flatMap((body) => [...body.matchAll(/\/producto\/(perf-\d+)</g)].map((m) => m[1]));
    expect(productLocs).toHaveLength(PRODUCTS);
    expect(new Set(productLocs).size).toBe(PRODUCTS);
    for (const body of productBodies) {
      expect((body.match(/<url>/g) ?? []).length).toBeLessThanOrEqual(SITEMAP_CHUNK_SIZE);
    }

    // The index counts the chunks (1 query), the page sitemap reads the category
    // closure (1), and each product file counts again and reads its slugs (2). A
    // read per product would show as thousands.
    expect(queries.length).toBeLessThanOrEqual(2 + 2 * chunks);
  }, 60000);
});
