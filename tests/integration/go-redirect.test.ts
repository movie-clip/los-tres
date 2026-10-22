import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { offers } from '@/db/schema';

import { resetDatabase } from '../support/db';
import { allClicks, callGo, insertGoOffer } from '../support/go';

// Guardrail 1 at /go/<offer>: only a visible offer redirects, and a refusal
// writes nothing. Each case changes exactly one thing from the visible baseline.

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

describe('GET /go/<offer> redirect (S1.1)', () => {
  it('redirects a visible offer with the normalised stored URL, no-store and an empty body', async () => {
    const { offerId, url } = await insertGoOffer();
    const response = await callGo(offerId);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(new URL(url).href);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('sends X-Robots-Tag: noindex, nofollow on the 302 and on the 404', async () => {
    const { offerId } = await insertGoOffer();
    const hiddenOffer = await insertGoOffer({ offer: { isHidden: true } });
    const redirect = await callGo(offerId);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const refusal = await callGo(hiddenOffer.offerId);
    expect(refusal.status).toBe(404);
    expect(refusal.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it.each(['HEAD', 'OPTIONS'] as const)('sends X-Robots-Tag on %s too', async (method) => {
    const { offerId } = await insertGoOffer();
    expect((await callGo(offerId, { method })).headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it.each(['GET', 'HEAD', 'OPTIONS'] as const)('answers %s with the same 302', async (method) => {
    const { offerId, url } = await insertGoOffer();
    const response = await callGo(offerId, { method });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(new URL(url).href);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  const hidden: [string, Parameters<typeof insertGoOffer>[0]][] = [
    ['the feed is not approved', { feed: { isApproved: false } }],
    ['the shop is not approved', { shop: { isApproved: false } }],
    ['the offer is hidden', { offer: { isHidden: true } }],
    ['the offer is in review', { offer: { inReview: true } }],
    ['the product is hidden', { product: { isHidden: true } }],
    ['the product is unmapped (no category)', { product: { categoryId: null } }],
  ];

  it.each(hidden)('404 and no click when %s', async (_name, setup) => {
    const { offerId } = await insertGoOffer(setup);
    const response = await callGo(offerId);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('');
    expect(await allClicks()).toEqual([]);
  });

  it('404 for an offer that an admin hides after it redirected', async () => {
    const { offerId } = await insertGoOffer();
    expect((await callGo(offerId)).status).toBe(302);
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, offerId));
    expect((await callGo(offerId)).status).toBe(404);
    expect(await allClicks()).toHaveLength(1);
  });

  it('404 and no click for an unknown id', async () => {
    const { offerId } = await insertGoOffer();
    const response = await callGo(offerId + 1000);
    expect(response.status).toBe(404);
    expect(await allClicks()).toEqual([]);
  });

  it.each(['abc', '0', '01', '-1', '1.5', '1e3', '1234567890', '%20', '1%20'])(
    '404 and no click for the malformed id %j',
    async (raw) => {
      await insertGoOffer();
      const response = await callGo(raw);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await allClicks()).toEqual([]);
    },
  );

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://affiliate.example/x', 'not a url'])(
    '404 and no click when the stored URL is %j',
    async (url) => {
      const { offerId } = await insertGoOffer({ offer: { url } });
      const response = await callGo(offerId);
      expect(response.status).toBe(404);
      expect(response.headers.get('location')).toBeNull();
      expect(await allClicks()).toEqual([]);
    },
  );

  it('redirects a stored URL with a non-ASCII character to an ASCII Location', async () => {
    const { offerId } = await insertGoOffer({
      offer: { url: 'https://affiliate.example/filtro-ñ?q=aceite é' },
    });
    const response = await callGo(offerId);
    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toMatch(/^[\x20-\x7e]+$/);
    expect(location.startsWith('https://affiliate.example/')).toBe(true);
  });

  it('never puts the stored URL in a 404 body or header', async () => {
    const { offerId, url } = await insertGoOffer({ offer: { isHidden: true } });
    const response = await callGo(offerId);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(url);
    expect(JSON.stringify([...response.headers])).not.toContain('affiliate.example');
  });
});
