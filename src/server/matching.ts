import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { products } from '../db/schema';

// The one matcher (0008, S7.1). Step 1 matches by EAN, step 2 by brand +
// normalised part number; anything else is a new product. A conflict or an
// ambiguity is not a rejection: the offer becomes its own product (D-5) and the
// matcher says why. The matcher reads `products` only and sets no flag.

export type ParsedEan =
  | { kind: 'absent' }
  | { kind: 'valid'; normalised: string }
  | { kind: 'invalid' };

/**
 * EAN rules: blank is absent. Otherwise spaces and hyphens are removed and what
 * is left must be digits only, 8 or 13 long, with a correct GS1 check digit.
 * The normalised value is that digit string, not padded.
 */
export function parseEan(raw: string | null | undefined): ParsedEan {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return { kind: 'absent' };
  const digits = trimmed.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits) || (digits.length !== 8 && digits.length !== 13)) {
    return { kind: 'invalid' };
  }
  // GS1: weights 3,1,3,1,... from the digit left of the check digit.
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i -= 1, weight = 4 - weight) {
    sum += Number(digits[i]) * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[digits.length - 1])
    ? { kind: 'valid', normalised: digits }
    : { kind: 'invalid' };
}

/** Removes spaces, hyphens and dots and upper-cases; empty gives `null`. */
export function normalizePartNumber(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/[\s.-]+/g, '').toUpperCase();
  return value === '' ? null : value;
}

/** Trims, collapses inner whitespace and upper-cases; empty gives `null`. */
export function normalizeBrand(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return value === '' ? null : value;
}

export type MatchCandidate = {
  eanNormalised: string | null;
  brandNormalised: string | null;
  partNumberNormalised: string | null;
};

export type OwnProductReason =
  | 'ean_brand_conflict' // one product holds the EAN, both brands known and different
  | 'ambiguous_ean' // two or more products hold the EAN
  | 'brand_part_number_ean_conflict' // no product holds the EAN; the one key holder carries another EAN
  | 'ambiguous_brand_part_number'; // two or more products hold the key

export type MatchResult =
  | { kind: 'attach'; productId: number }
  | { kind: 'none' }
  | { kind: 'own_product'; reason: OwnProductReason };

/** Step 2's lookup, exported so a plan test explains this exact query. At most 2 rows. */
export function selectByBrandPartNumber(
  db: Executor,
  key: { brandNormalised: string; partNumberNormalised: string },
) {
  return db
    .select({ id: products.id, eanNormalised: products.eanNormalised })
    .from(products)
    .where(
      and(
        eq(products.partNumberNormalised, key.partNumberNormalised),
        eq(products.brandNormalised, key.brandNormalised),
      ),
    )
    .limit(2);
}

/**
 * Finds the product a new offer belongs to. Step 1, EAN: two products with it
 * is ambiguous; one attaches unless both brands are known and differ (a
 * conflict); a null brand on either side is not a disagreement (TD-27). With no
 * product holding the EAN, step 2, brand + part number (both required): two
 * holders is ambiguous; one holder carrying an EAN while the candidate carries
 * another is a conflict; otherwise it attaches. A hidden product still matches:
 * the offer attaches and stays invisible with it. Conflicts and ambiguities
 * make the offer its own product (D-5).
 */
export async function matchProduct(db: Executor, candidate: MatchCandidate): Promise<MatchResult> {
  if (candidate.eanNormalised !== null) {
    const found = await db
      .select({ id: products.id, brandNormalised: products.brandNormalised })
      .from(products)
      .where(eq(products.eanNormalised, candidate.eanNormalised))
      .limit(2);
    if (found.length > 1) return { kind: 'own_product', reason: 'ambiguous_ean' };
    if (found.length === 1) {
      const [product] = found;
      if (
        product.brandNormalised !== null &&
        candidate.brandNormalised !== null &&
        product.brandNormalised !== candidate.brandNormalised
      ) {
        return { kind: 'own_product', reason: 'ean_brand_conflict' };
      }
      return { kind: 'attach', productId: product.id };
    }
  }

  if (candidate.brandNormalised === null || candidate.partNumberNormalised === null) {
    return { kind: 'none' };
  }
  const holders = await selectByBrandPartNumber(db, {
    brandNormalised: candidate.brandNormalised,
    partNumberNormalised: candidate.partNumberNormalised,
  });
  if (holders.length === 0) return { kind: 'none' };
  if (holders.length > 1) return { kind: 'own_product', reason: 'ambiguous_brand_part_number' };
  const [holder] = holders;
  if (candidate.eanNormalised !== null && holder.eanNormalised !== null) {
    return { kind: 'own_product', reason: 'brand_part_number_ean_conflict' };
  }
  return { kind: 'attach', productId: holder.id };
}
