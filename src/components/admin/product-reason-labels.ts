import type { getTranslations } from 'next-intl/server';

import type { NotPublicReason } from '@/server/admin/products';

// Finished "Motivo:" texts for the product screens, built from `Admin.Products`
// once per request by the two product pages. Pure: the server sends a closed
// code, this file names its message key, and no component reads messages.

/** The translator of the product strings, `getTranslations('Admin.Products')`. */
export type ProductsTranslate = Awaited<ReturnType<typeof getTranslations<'Admin.Products'>>>;

/** The message keys of the reason lines, one per code (03-ux.md § Copy). */
export type ReasonKey =
  | 'reasonOfferShop'
  | 'reasonOfferFeed'
  | 'reasonOfferCollected'
  | 'reasonOfferRemoved'
  | 'reasonOfferHidden'
  | 'reasonOfferReview'
  | 'reasonProductNoCategory'
  | 'reasonProductCollected'
  | 'reasonProductHidden'
  | 'reasonProductNoOffers'
  | 'reasonProductOffersShop'
  | 'reasonProductOffersFeed'
  | 'reasonProductOffersCollected'
  | 'reasonProductOffersRemoved'
  | 'reasonProductOffersHidden'
  | 'reasonProductOffersReview'
  | 'reasonUnknown';

/**
 * Every code to its key. Total by type: a code added to the server's closed set
 * fails typecheck here until it has a key and a line.
 */
export const REASON_KEY: Record<NotPublicReason, ReasonKey> = {
  offer_shop_not_approved: 'reasonOfferShop',
  offer_feed_not_approved: 'reasonOfferFeed',
  offer_collected: 'reasonOfferCollected',
  offer_removed: 'reasonOfferRemoved',
  offer_hidden: 'reasonOfferHidden',
  offer_in_review: 'reasonOfferReview',
  product_no_category: 'reasonProductNoCategory',
  product_collected: 'reasonProductCollected',
  product_hidden: 'reasonProductHidden',
  product_no_offers: 'reasonProductNoOffers',
  offers_shop_not_approved: 'reasonProductOffersShop',
  offers_feed_not_approved: 'reasonProductOffersFeed',
  offers_collected: 'reasonProductOffersCollected',
  offers_removed: 'reasonProductOffersRemoved',
  offers_hidden: 'reasonProductOffersHidden',
  offers_in_review: 'reasonProductOffersReview',
  unknown: 'reasonUnknown',
};

/** The finished text of every code, for a page to pick from and to hand to a toggle. */
export function reasonLabels(t: ProductsTranslate): Record<NotPublicReason, string> {
  const entries = (Object.keys(REASON_KEY) as NotPublicReason[]).map((code) => [code, t(REASON_KEY[code])] as const);
  return Object.fromEntries(entries) as Record<NotPublicReason, string>;
}
