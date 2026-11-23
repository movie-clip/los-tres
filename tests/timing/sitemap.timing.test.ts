import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as getIndex } from '@/app/(public)/sitemap.xml/route';
import { GET as getFile } from '@/app/(public)/sitemaps/[file]/route';
import { closeDb } from '@/db/client';

import { resetDatabase } from '../support/db';
import { median, seedSitemapProducts, timingHeader, writeTimingReport } from '../support/scale-fixtures';

// S6.2 design: the sitemap is generated per request, with no index and no
// cache, so 10,000 public products must stay cheap. Run by `npm run test:timing`
// (one worker, on demand); the gate does not run it and asserts no time
// (no-clock-in-gate, S-1). The table is printed and written to timing-results/
// before the assertion. The only assertion is the generous 3,000 ms ceiling on
// the median of RUNS sequences (the index, then every file it names): the real
// cost is milliseconds.

const PRODUCTS = 10000;
const RUNS = 5;
const CEILING_MS = 3000;

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

async function sequence(): Promise<number> {
  const started = performance.now();
  const index = await getIndex();
  const indexBody = await index.text();
  const files = [...indexBody.matchAll(/<loc>[^<]*\/sitemaps\/([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const file of files) {
    const response = await getFile(new Request(`http://127.0.0.1:3000/sitemaps/${file}`), {
      params: Promise.resolve({ file }),
    });
    expect(response.status).toBe(200);
    await response.text();
  }
  return performance.now() - started;
}

describe('sitemap generation at scale, timed', () => {
  it('generates the index, every product chunk and the page sitemap for 10,000 products', async () => {
    await seedSitemapProducts(PRODUCTS);

    // One warm-up sequence, then RUNS timed ones.
    await sequence();
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      samples.push(await sequence());
    }
    const middle = median(samples);

    writeTimingReport('sitemap', [
      await timingHeader(),
      '',
      `sitemap: ${PRODUCTS} public products, index plus every file it names, median and max of ${RUNS} warm sequences (ms)`,
      '',
      'sequence | median | max',
      `index + files | ${middle.toFixed(1).padStart(6)} | ${Math.max(...samples).toFixed(1).padStart(5)}`,
      '',
      `raw samples, in call order: ${samples.map((v) => v.toFixed(1)).join(', ')}`,
    ]);

    expect(middle).toBeLessThan(CEILING_MS);
  }, 60000);
});
