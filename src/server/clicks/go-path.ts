// The /go path of an offer and the parse of its path segment. Pure: no
// server-only import, no I/O.

const OFFER_PARAM = /^[1-9][0-9]{0,8}$/;

/** The relative path of the redirect for an offer: /go/<offers.id>. */
export function goPath(offerId: number): string {
  if (!Number.isInteger(offerId) || offerId <= 0) {
    throw new RangeError('goPath needs a positive integer offer id');
  }
  return `/go/${offerId}`;
}

/**
 * The offer id in a /go path segment, or null. Only 1 to 9 digits with no
 * leading zero are accepted, so the value fits the integer id column and
 * nothing else reaches a query.
 */
export function parseOfferParam(raw: string): number | null {
  return OFFER_PARAM.test(raw) ? Number(raw) : null;
}
