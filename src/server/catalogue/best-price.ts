// The one place the "Mejor precio" rule (D-1) is coded. Pure: no db, no
// `server-only`, so unit tests import it. Integer cents only (guardrail 4).

/**
 * Which offers carry the best-price tag. An offer is the best price when its
 * price equals the lowest of the given prices AND the prices hold at least two
 * distinct values. One offer, or every offer at one price, flags nothing; a tie
 * at the lowest flags every tied offer. The result has the input's length and
 * order; the rule is by value, not by position.
 */
export function bestPriceFlags(pricesCents: readonly number[]): boolean[] {
  if (pricesCents.length === 0) return [];
  const lowest = Math.min(...pricesCents);
  const hasDearer = pricesCents.some((price) => price > lowest);
  return pricesCents.map((price) => hasDearer && price === lowest);
}
