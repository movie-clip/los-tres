import 'server-only';

import { eq } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { products } from '../db/schema';

// The one matcher (0008). Slice B implements step 1 (EAN) and step 3 (new
// product). Step 2, brand + normalised part number, has no code path yet: it
// goes in `matchProduct`, between the EAN lookup and the "none" result.

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

export type MatchResult =
  | { kind: 'attach'; productId: number }
  | { kind: 'none' }
  | { kind: 'reject'; code: 'ean_brand_conflict' | 'ambiguous_ean' };

/**
 * Finds the product a new offer belongs to. EAN: exactly one product with the
 * same normalised EAN attaches, unless both brands are known and differ
 * (rejected, D-1 Q5). More than one product with that EAN is ambiguous. A null
 * brand on either side is not a disagreement (TD-27). A hidden product still
 * matches: the offer attaches and stays invisible with it.
 */
export async function matchProduct(
  db: Executor,
  candidate: { eanNormalised: string | null; brandNormalised: string | null },
): Promise<MatchResult> {
  if (candidate.eanNormalised === null) return { kind: 'none' };
  const found = await db
    .select({ id: products.id, brandNormalised: products.brandNormalised })
    .from(products)
    .where(eq(products.eanNormalised, candidate.eanNormalised))
    .limit(2);
  if (found.length === 0) return { kind: 'none' };
  if (found.length > 1) return { kind: 'reject', code: 'ambiguous_ean' };
  const [product] = found;
  if (
    product.brandNormalised !== null &&
    candidate.brandNormalised !== null &&
    product.brandNormalised !== candidate.brandNormalised
  ) {
    return { kind: 'reject', code: 'ean_brand_conflict' };
  }
  return { kind: 'attach', productId: product.id };
}
