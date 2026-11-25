import type { HideActionState } from '@/app/admin/(shell)/productos/actions';
import type { NotPublicReason } from '@/server/admin/products';

// What one hide toggle shows: the action's stored answer while the page's read
// is the one it arrived with, the page's read otherwise. Pure, so the choice is
// testable without a DOM; `ProductHideToggle` keeps the arrival in its state.

/** The three facts of a product or an offer, as a read or an answer carries them. */
export type HideFacts = {
  hidden: boolean;
  publicNow: boolean;
  /** The not-public code, null exactly when `publicNow` is true. */
  reason: NotPublicReason | null;
};

/**
 * The key of one read. A read that changed any fact, the reason alone included
 * (an offer press can change the product's reason and nothing else), has a new key.
 */
export function hideReadKey(read: HideFacts): string {
  return `${read.hidden}|${read.publicNow}|${read.reason ?? ''}`;
}

/**
 * The facts to show. The answer counts only when it is a stored result for this
 * very row and the page's read has not changed since it arrived (`arrivedReadKey`
 * is the read key at the moment the answer arrived); a newer read takes over.
 */
export function shownHideFacts(
  state: HideActionState,
  kind: 'product' | 'offer',
  id: number,
  read: HideFacts,
  arrivedReadKey: string,
): HideFacts {
  const stored =
    state.status === 'done' && state.kind === kind && state.id === id && arrivedReadKey === hideReadKey(read)
      ? state
      : null;
  if (!stored) return read;
  return { hidden: stored.hidden, publicNow: stored.publicNow, reason: stored.reason };
}
