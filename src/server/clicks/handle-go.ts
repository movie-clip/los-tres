import 'server-only';

import { getDb } from '../../db/client';
import { errorCode } from '../error-code';
import { skipReason } from './counting';
import { parseOfferParam } from './go-path';
import { getRedirectTarget, type RedirectTarget } from './offer-target';
import { recordClick } from './record';
import { sourcePageFromReferer } from './source-page';

// The decision behind /go/<offer>. The route file only adapts Request to
// GoRequest and GoResult to Response.
//
// Logging: the only lines this path writes are the two fixed failure lines
// below, each with an error code. Nothing logs a header, an offer URL, a
// Referer or an id from the request. A success and a 404 log nothing.

export type GoRequest = {
  method: string;
  offerParam: string;
  headers: Pick<Headers, 'get'>;
};

export type GoResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

export async function handleGo(req: GoRequest): Promise<GoResult> {
  const offerId = parseOfferParam(req.offerParam);
  if (offerId === null) return { kind: 'not_found' };

  let target: RedirectTarget | null;
  try {
    target = await getRedirectTarget(offerId);
  } catch (error) {
    console.error(`go: lookup failed (${errorCode(error)})`);
    return { kind: 'unavailable' };
  }
  if (target === null) return { kind: 'not_found' };

  let location: URL;
  try {
    location = new URL(target.url);
  } catch {
    return { kind: 'not_found' };
  }
  if (location.protocol !== 'http:' && location.protocol !== 'https:') {
    return { kind: 'not_found' };
  }

  // Excluded requests get the same redirect as a counted one; only the row differs.
  const skip = skipReason({
    method: req.method,
    headers: req.headers,
    isDemoFeed: target.isDemoFeed,
  });
  if (skip === null) {
    try {
      await recordClick(getDb(), {
        offerId: target.offerId,
        shopId: target.shopId,
        productId: target.productId,
        sourcePage: sourcePageFromReferer(req.headers.get('referer'), req.headers.get('host')),
      });
    } catch (error) {
      // The visitor is still sent to the shop.
      console.error(`go: click not recorded (${errorCode(error)})`);
    }
  }

  return { kind: 'redirect', location: location.href };
}
