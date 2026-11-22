// The removal guard of an import (S3.3). Pure: no database, no server-only.
// The importer (./index.ts) measures the counts in the feed's transaction and
// writes what this decides; this file writes nothing.

import type { RemovalSkipReason } from './types';

/** Fewer missing offers than this never trips the small-import guard (D-1). */
export const REMOVAL_GUARD_MIN_MISSING = 10;
/** The small-import guard trips when more than this share of live offers is missing (D-2). */
export const REMOVAL_GUARD_MAX_PERCENT = 50;
/** Offer ids per removal statement. */
export const REMOVAL_CHUNK = 1000;

export type RemovalDecision =
  | { kind: 'none' }
  | { kind: 'remove' }
  | { kind: 'skip'; reason: RemovalSkipReason };

/**
 * `current`: the feed's live (not removed) offers before the import.
 * `missing`: those whose external id no accepted row named. `accepted`: the
 * distinct external ids of accepted rows. `allowLargeRemoval` lifts the
 * small-import guard only, never the empty-import one (D-3). Integer arithmetic.
 */
export function decideRemoval(input: {
  current: number;
  missing: number;
  accepted: number;
  allowLargeRemoval: boolean;
}): RemovalDecision {
  const { current, missing, accepted, allowLargeRemoval } = input;
  if (missing === 0) return { kind: 'none' };
  if (accepted === 0) return { kind: 'skip', reason: 'empty_import' };
  if (
    missing >= REMOVAL_GUARD_MIN_MISSING &&
    missing * 100 > current * REMOVAL_GUARD_MAX_PERCENT &&
    !allowLargeRemoval
  ) {
    return { kind: 'skip', reason: 'small_import' };
  }
  return { kind: 'remove' };
}
