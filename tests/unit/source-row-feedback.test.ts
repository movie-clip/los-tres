import { describe, expect, it } from 'vitest';

import type { SourceActionState } from '@/app/admin/(shell)/tiendas/actions';
import {
  initialFeedbackMemo,
  nextFeedbackMemo,
  shownFeedback,
  type FeedbackMemo,
} from '@/components/admin/source-row-feedback';

// #384: a stored result of a shop (approve or disable) ends the answer its feed rows still show
// (a result line, or the error block), because the press on the shop is a newer fact about the
// feed. Which answer a feed row shows, given its own action state, its pending flag and its
// shop's results over time, is a pure choice, so it is proved without a DOM. Identity decides:
// every state below is a distinct object, as the server action returns one per call, so two
// equal results are still two results. That the screen applies the rule on the real shop action
// is proved by journey J9 of tests/e2e/admin-feeds.spec.ts; neither test can observe the other.

const idle: SourceActionState = { status: 'idle' };

const feedDone = (approved = true): SourceActionState => ({
  status: 'done',
  kind: 'feed',
  id: 7,
  approved,
  shopApproved: true,
});
const feedFailed = (): SourceActionState => ({ status: 'failed', kind: 'feed', id: 7 });
const shopDone = (approved: boolean): SourceActionState => ({ status: 'done', kind: 'shop', id: 3, approved });
const shopFailed = (): SourceActionState => ({ status: 'failed', kind: 'shop', id: 3 });

/** One render of a feed row: the memo it holds after seeing `shopResult`, and what it shows for `own`. */
function render(memo: FeedbackMemo, shopResult: SourceActionState | null, own: SourceActionState, pending = false) {
  const next = nextFeedbackMemo(memo, shopResult, own);
  return { memo: next, shown: shownFeedback(own, pending, next) };
}

describe('a stored shop result ends the answer a feed row shows (#384)', () => {
  it('ends a done line when the shop is disabled', () => {
    const own = feedDone();
    const first = render(initialFeedbackMemo(idle), idle, own);
    expect(first.shown).toBe(own);

    const afterShop = render(first.memo, shopDone(false), own);
    expect(afterShop.shown).toBeNull();
  });

  it('ends a done line when the shop is approved', () => {
    const own = feedDone();
    const first = render(initialFeedbackMemo(idle), idle, own);

    expect(render(first.memo, shopDone(true), own).shown).toBeNull();
  });

  it('ends the error block of a failed feed press', () => {
    const own = feedFailed();
    const first = render(initialFeedbackMemo(idle), idle, own);
    expect(first.shown).toBe(own);

    expect(render(first.memo, shopDone(false), own).shown).toBeNull();
  });

  it('ends the answer in the same render that sees the shop result, not a render later', () => {
    const own = feedDone();
    const memo = initialFeedbackMemo(idle);

    // One call sees the new shop state and already hides the line: no render shows both.
    const next = nextFeedbackMemo(memo, shopDone(false), own);
    expect(shownFeedback(own, false, next)).toBeNull();
    // The memo from before that render still shows it, so the hiding is the memo's doing.
    expect(shownFeedback(own, false, memo)).toBe(own);
  });

  it('ends every feed row of the shop: each row holds its own memo and sees the same shop state', () => {
    const shop = shopDone(false);
    const ownA = feedDone();
    const ownB = feedFailed();
    const rowA = render(initialFeedbackMemo(idle), idle, ownA);
    const rowB = render(initialFeedbackMemo(idle), idle, ownB);

    expect(render(rowA.memo, shop, ownA).shown).toBeNull();
    expect(render(rowB.memo, shop, ownB).shown).toBeNull();
  });
});

describe('what a shop action does not end (#384)', () => {
  it('keeps the feed answer when the shop action failed', () => {
    const own = feedDone();
    const first = render(initialFeedbackMemo(idle), idle, own);

    const afterFailure = render(first.memo, shopFailed(), own);
    expect(afterFailure.shown).toBe(own);
    // Nothing was ended, so a failure keeps the previous record rather than clearing it.
    expect(afterFailure.memo.endedFor).toBeNull();
  });

  it('keeps an end already recorded when a later shop action fails', () => {
    const own = feedDone();
    const ended = render(render(initialFeedbackMemo(idle), idle, own).memo, shopDone(false), own);
    expect(ended.shown).toBeNull();

    const afterFailure = render(ended.memo, shopFailed(), own);
    expect(afterFailure.shown).toBeNull();
    expect(afterFailure.memo.endedFor).toBe(ended.memo.endedFor);
  });

  it('changes nothing when the shop state is the same object, as in a re-render or a revalidated read', () => {
    const own = feedDone();
    const shop = shopDone(false);
    const ended = render(render(initialFeedbackMemo(idle), idle, own).memo, shop, own);

    const again = nextFeedbackMemo(ended.memo, shop, own);
    expect(again).toBe(ended.memo);
    expect(shownFeedback(own, false, again)).toBeNull();
  });

  it('records nothing for a shop state the row arrived with (a row mounted after the shop result)', () => {
    const shop = shopDone(false);
    const memo = initialFeedbackMemo(shop);
    expect(memo.endedFor).toBeNull();

    const own = feedDone();
    expect(nextFeedbackMemo(memo, shop, own)).toBe(memo);
    expect(shownFeedback(own, false, memo)).toBe(own);
  });

  it('never ends a row that is given no shop result, as the shop row itself', () => {
    const own = shopDone(false);
    let memo = initialFeedbackMemo(null);
    for (const result of [own, shopFailed(), shopDone(true)]) {
      const next = render(memo, null, result);
      memo = next.memo;
      expect(next.shown).toBe(result);
      expect(memo.endedFor).toBeNull();
    }
  });
});

describe('the feed row\'s next answer after an end (#384)', () => {
  it('shows a new own result, though the one before it was ended', () => {
    const first = feedDone();
    const ended = render(render(initialFeedbackMemo(idle), idle, first).memo, shopDone(false), first);
    expect(ended.shown).toBeNull();

    const second = feedDone(false);
    expect(render(ended.memo, ended.memo.shopResult, second).shown).toBe(second);
  });

  it('shows a new own result that equals the ended one, because it is another object', () => {
    const first = feedDone();
    const ended = render(render(initialFeedbackMemo(idle), idle, first).memo, shopDone(false), first);

    const same = feedDone();
    expect(same).toEqual(first);
    expect(render(ended.memo, ended.memo.shopResult, same).shown).toBe(same);
  });

  it('ends the new result in turn when a second shop result arrives', () => {
    const first = feedDone();
    const afterFirstShop = render(render(initialFeedbackMemo(idle), idle, first).memo, shopDone(false), first);
    const second = feedFailed();
    const shown = render(afterFirstShop.memo, afterFirstShop.memo.shopResult, second);
    expect(shown.shown).toBe(second);

    expect(render(shown.memo, shopDone(true), second).shown).toBeNull();
  });

  it('ends nothing of a row that was idle when the shop result came, and shows its first answer', () => {
    const afterShop = render(initialFeedbackMemo(idle), shopDone(false), idle);
    expect(afterShop.shown).toBeNull();
    expect(afterShop.memo.endedFor).toBe(idle);

    const own = feedDone();
    expect(render(afterShop.memo, afterShop.memo.shopResult, own).shown).toBe(own);
  });

  it('survives two shop results in a row, ending the same answer once and showing the next', () => {
    const own = feedDone();
    const one = render(render(initialFeedbackMemo(idle), idle, own).memo, shopDone(false), own);
    const two = render(one.memo, shopDone(true), own);
    expect(one.shown).toBeNull();
    expect(two.shown).toBeNull();

    const next = feedDone(false);
    expect(render(two.memo, two.memo.shopResult, next).shown).toBe(next);
  });
});

describe('what a row shows while it works or has nothing to show (#384)', () => {
  it('shows nothing while its own action is pending, whatever it held before', () => {
    const own = feedDone();
    const memo = initialFeedbackMemo(idle);
    expect(shownFeedback(own, true, memo)).toBeNull();
    expect(shownFeedback(own, false, memo)).toBe(own);
  });

  it('shows nothing for an idle row', () => {
    expect(shownFeedback(idle, false, initialFeedbackMemo(idle))).toBeNull();
  });

  it('shows the answer again once pending ends, when no shop result ended it', () => {
    const own = feedFailed();
    const memo = initialFeedbackMemo(idle);
    expect(shownFeedback(own, true, memo)).toBeNull();
    expect(shownFeedback(own, false, memo)).toBe(own);
  });
});
