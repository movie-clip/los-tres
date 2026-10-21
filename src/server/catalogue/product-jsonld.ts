import type { PublicProductPage } from './product-page';
import { centsToDecimalString } from '../money';

// The schema.org Product for the public product page, derived from the one
// visible-offer read (PublicProductPage), never from a second query
// (guardrail 1). No `server-only`: unit tests import this module.

export type ProductJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'Product';
  name: string;
  description?: string;
  brand?: { '@type': 'Brand'; name: string };
  mpn?: string;
  gtin?: string;
  offers: {
    '@type': 'AggregateOffer';
    priceCurrency: 'EUR';
    lowPrice: string;
    highPrice: string;
    offerCount: number;
  };
};

// GTIN-8, GTIN-12, GTIN-13 and GTIN-14. The stored EAN is raw, so anything
// else is left out rather than sent to a search engine.
const GTIN = /^(\d{8}|\d{12,14})$/;

/**
 * The Product object for a product page, or `null` when it has no visible
 * offer: there is no price to state, and no last-known price is used. Absent
 * values are omitted keys, never `null` or `""`. Prices are decimal strings
 * built from integer cents; low and high are the min and max, not first and
 * last, so they do not depend on the read's sort order.
 */
export function buildProductJsonLd(product: PublicProductPage): ProductJsonLd | null {
  if (product.offers.length === 0) return null;

  let low = product.offers[0]!.priceCents;
  let high = low;
  for (const offer of product.offers) {
    if (offer.priceCents < low) low = offer.priceCents;
    if (offer.priceCents > high) high = offer.priceCents;
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    ...(product.description !== null && { description: product.description }),
    ...(product.brand !== null && { brand: { '@type': 'Brand' as const, name: product.brand } }),
    ...(product.partNumber !== null && { mpn: product.partNumber }),
    ...(product.ean !== null && GTIN.test(product.ean) && { gtin: product.ean }),
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'EUR',
      lowPrice: centsToDecimalString(low),
      highPrice: centsToDecimalString(high),
      offerCount: product.offers.length,
    },
  };
}

/**
 * JSON for the body of a `<script type="application/ld+json">` tag. After
 * `JSON.stringify`, `<`, `>`, `&`, U+2028 and U+2029 become `\uXXXX` escapes,
 * so the text cannot close the tag or open a comment, and still parses back to
 * the same value. The only place JSON-LD is serialised.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
