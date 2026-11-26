// The one statement of the EAN-fill rule (S7.6, D-1 to D-5, D-13). Pure: no
// database, no `server-only`. It decides from what the importer already read;
// whether another product holds the EAN needs the database and is the
// importer's (`fillEmptyEan` in ./index.ts, through matching.ts `selectByEan`).
// It reads raw approval, hidden and review states, never the visibility scope:
// the local flag must never decide a fill (S7.6 AC 11).

/** What the importer knows about one accepted row when it may fill (S7.6). */
export type EanFillFacts = {
  /** The row's EAN as createProduct writes it: the trimmed cell and its digit form, both null when absent. */
  row: { ean: string | null; eanNormalised: string | null };
  /** The row's feed is a collected feed (S12.2). */
  markedRow: boolean;
  shopApproved: boolean;
  feedApproved: boolean;
  /** The row's own offer, after this import wrote it. A new offer is { isHidden: false, inReview: false }. */
  offer: { isHidden: boolean; inReview: boolean };
  /**
   * The product the offer sits on, as read in this transaction. `marked`: the
   * product was created from a row of a collected feed (S12.2).
   */
  product: { ean: string | null; eanNormalised: string | null; isHidden: boolean; marked: boolean };
};

export type EanFillSkip =
  | 'no_ean' // the row carries none (an invalid one never reaches here: invalid_ean)
  | 'product_has_ean' // either EAN column of the product is non-null (AC 15, DT-4)
  | 'other_side' // the product's marker differs from the row's (D-3, ACs 9, 10, DT-8)
  | 'feed_not_approved'
  | 'shop_not_approved'
  | 'offer_hidden'
  | 'offer_in_review'
  | 'product_hidden'; // D-13

export type EanFillDecision =
  | { kind: 'skip'; reason: EanFillSkip }
  | { kind: 'try'; ean: string; eanNormalised: string };

/**
 * Whether the row may fill its product's empty EAN. Checks in the order of
 * `EanFillSkip`; the first that holds is the reason. `try` means "fill unless
 * another product holds the EAN". The reason is never reported (D-4, D-6).
 */
export function decideEanFill(facts: EanFillFacts): EanFillDecision {
  const skip = (reason: EanFillSkip): EanFillDecision => ({ kind: 'skip', reason });
  const { row, product, offer } = facts;
  if (row.ean === null || row.eanNormalised === null) return skip('no_ean');
  if (product.ean !== null || product.eanNormalised !== null) return skip('product_has_ean');
  if (product.marked !== facts.markedRow) return skip('other_side');
  if (!facts.feedApproved) return skip('feed_not_approved');
  if (!facts.shopApproved) return skip('shop_not_approved');
  if (offer.isHidden) return skip('offer_hidden');
  if (offer.inReview) return skip('offer_in_review');
  if (product.isHidden) return skip('product_hidden');
  return { kind: 'try', ean: row.ean, eanNormalised: row.eanNormalised };
}
