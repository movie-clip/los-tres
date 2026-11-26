import type { SourceActionState } from '@/app/admin/(shell)/tiendas/actions';

// What one source row shows under its controls: its own action's answer, unless
// a newer stored result of its shop has ended that answer (#384). Pure, so the
// choice is testable without a DOM; `SourceRow` keeps the memo in its state.

/**
 * What a row remembers about its shop's results: the shop state it last saw, and
 * the row's own answer that a stored shop result ended (null while none has).
 */
export type FeedbackMemo = {
  shopResult: SourceActionState | null;
  endedFor: SourceActionState | null;
};

/** The memo of a row's first render: the shop state it arrived with, nothing ended. */
export function initialFeedbackMemo(shopResult: SourceActionState | null): FeedbackMemo {
  return { shopResult, endedFor: null };
}

/**
 * The memo after a render. The same shop state object (a re-render, a revalidated
 * read) changes nothing and returns `memo` itself. A new stored shop result
 * (`done`) ends the row's current answer `own`; a new failed or idle shop state
 * ends nothing and keeps what was ended before.
 */
export function nextFeedbackMemo(
  memo: FeedbackMemo,
  shopResult: SourceActionState | null,
  own: SourceActionState,
): FeedbackMemo {
  if (shopResult === memo.shopResult) return memo;
  return { shopResult, endedFor: shopResult?.status === 'done' ? own : memo.endedFor };
}

/** The answer to show: none while pending, none for idle, none once a shop result ended it. */
export function shownFeedback(
  own: SourceActionState,
  pending: boolean,
  memo: FeedbackMemo,
): Exclude<SourceActionState, { status: 'idle' }> | null {
  if (pending || own.status === 'idle' || own === memo.endedFor) return null;
  return own;
}
