import { asc } from 'drizzle-orm';

import { GET, HEAD, OPTIONS } from '@/app/(public)/go/[offer]/route';
import { getDb } from '@/db/client';
import { clicks } from '@/db/schema';

import { insertFeed, insertOffer, insertProduct, insertShop } from './catalogue';

// Support for the /go integration tests: call the real route handlers with a
// plain Request, and read the click log.

export const GO_HOST = 'shop.test';

const handlers = { GET, HEAD, OPTIONS } as const;

/**
 * Calls the exported route handler for `method` the way Next does: a Request
 * and `params` as a Promise. The default request is a countable one (GET, a
 * browser user agent, our own Host). A header set to `null` is removed.
 */
export async function callGo(
  offer: number | string,
  o: { method?: keyof typeof handlers; headers?: Record<string, string | null> } = {},
): Promise<Response> {
  const method = o.method ?? 'GET';
  const headers = new Headers({
    host: GO_HOST,
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  for (const [name, value] of Object.entries(o.headers ?? {})) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  const request = new Request(`http://${GO_HOST}/go/${offer}`, { method, headers });
  return handlers[method](request, { params: Promise.resolve({ offer: String(offer) }) });
}

export async function allClicks() {
  return getDb().select().from(clicks).orderBy(asc(clicks.id));
}

/**
 * One offer in the fully VISIBLE state (approved shop and feed, a non-demo
 * feed, nothing hidden), with the one thing a test is about overridden.
 */
export async function insertGoOffer(
  o: {
    shop?: { isApproved?: boolean };
    feed?: { isApproved?: boolean; isDemo?: boolean };
    product?: { isHidden?: boolean };
    offer?: { isHidden?: boolean; inReview?: boolean; url?: string };
  } = {},
) {
  const shop = await insertShop(o.shop);
  const feedId = await insertFeed(shop.id, o.feed);
  const product = await insertProduct(o.product);
  const url = o.offer?.url ?? 'https://affiliate.example/p/1?tag=abc';
  const offerId = await insertOffer({ productId: product.id, feedId, ...o.offer, url });
  return { shop, feedId, product, offerId, url };
}
