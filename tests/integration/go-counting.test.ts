import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb } from '@/db/client';

import { resetDatabase } from '../support/db';
import { allClicks, callGo, GO_HOST, insertGoOffer } from '../support/go';

// Each counting rule on its own, on an otherwise countable request (GET, a
// browser user agent, a non-demo feed): a skip test changes exactly one thing,
// so another rule can never be the reason a row is missing.

const CUBOT =
  'Mozilla/5.0 (Linux; Android 13; CUBOT P80) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Mobile Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

describe('counted click (S1.1)', () => {
  it('writes exactly one row with the offer, shop, product and a time, and nothing else', async () => {
    const before = Date.now();
    const { offerId, shop, product, url } = await insertGoOffer();
    const response = await callGo(offerId);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(new URL(url).href);

    const rows = await allClicks();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'createdAt',
      'id',
      'offerId',
      'productId',
      'shopId',
      'sourcePage',
    ]);
    expect(rows[0]).toMatchObject({
      offerId,
      shopId: shop.id,
      productId: product.id,
      sourcePage: null,
    });
    const at = rows[0].createdAt.getTime();
    expect(at).toBeGreaterThan(before - 60_000);
    expect(at).toBeLessThan(Date.now() + 60_000);
  });

  it('writes one row per GET: two requests, two rows', async () => {
    const { offerId } = await insertGoOffer();
    await callGo(offerId);
    await callGo(offerId);
    expect(await allClicks()).toHaveLength(2);
  });

  it.each([
    ['a browser user agent', undefined],
    ['no user agent at all', { 'user-agent': null }],
    ['a CUBOT phone user agent (not a crawler)', { 'user-agent': CUBOT }],
    ['a headless browser user agent', { 'user-agent': 'HeadlessChrome/130.0.0.0' }],
  ] as const)('counts a request with %s', async (_name, headers) => {
    const { offerId } = await insertGoOffer();
    const response = await callGo(offerId, { headers });
    expect(response.status).toBe(302);
    expect(await allClicks()).toHaveLength(1);
  });
});

describe('requests redirected but not counted (S1.1)', () => {
  const skipped: [string, Parameters<typeof callGo>[1], Parameters<typeof insertGoOffer>[0]][] = [
    ['HEAD', { method: 'HEAD' }, {}],
    ['OPTIONS', { method: 'OPTIONS' }, {}],
    ['Purpose: prefetch', { headers: { purpose: 'prefetch' } }, {}],
    ['Sec-Purpose: prefetch', { headers: { 'sec-purpose': 'prefetch' } }, {}],
    ['Sec-Purpose: prefetch;prerender', { headers: { 'sec-purpose': 'prefetch;prerender' } }, {}],
    ['a Googlebot user agent', { headers: { 'user-agent': GOOGLEBOT } }, {}],
    ['a demo-feed offer', undefined, { feed: { isDemo: true } }],
  ];

  it.each(skipped)('gives %s the same 302 as a counted click and writes no row', async (_name, request, setup) => {
    const { offerId, url } = await insertGoOffer(setup);
    const baseline = await insertGoOffer();
    const counted = await callGo(baseline.offerId);
    expect(counted.status).toBe(302);
    expect(await allClicks()).toHaveLength(1);

    const response = await callGo(offerId, request);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(new URL(url).href);
    expect(response.headers.get('cache-control')).toBe(counted.headers.get('cache-control'));
    expect(await response.text()).toBe('');
    // Still one row: the baseline's, none for the skipped request.
    expect(await allClicks()).toHaveLength(1);
  });
});

describe('source page (S1.1)', () => {
  const sourceOf = async (headers?: Record<string, string | null>) => {
    const { offerId } = await insertGoOffer();
    await callGo(offerId, { headers });
    const rows = await allClicks();
    return rows[rows.length - 1].sourcePage;
  };

  it('stores the path of a same-origin Referer', async () => {
    expect(await sourceOf({ referer: `http://${GO_HOST}/producto/filtro-1` })).toBe('/producto/filtro-1');
  });

  it('stores the bare path when the same-origin Referer has a query and a fragment', async () => {
    const stored = await sourceOf({ referer: `http://${GO_HOST}/producto/filtro-1?q=secret-value#frag` });
    expect(stored).toBe('/producto/filtro-1');
  });

  it('stores null for a cross-origin Referer', async () => {
    expect(await sourceOf({ referer: 'https://elsewhere.example/producto/filtro-1' })).toBeNull();
  });

  it('stores null when there is no Referer', async () => {
    expect(await sourceOf()).toBeNull();
  });

  it('stores null for a same-origin Referer that is not a plain site path', async () => {
    expect(await sourceOf({ referer: `http://${GO_HOST}/Producto/A%20B` })).toBeNull();
  });
});
