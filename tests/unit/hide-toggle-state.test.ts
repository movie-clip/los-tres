import { describe, expect, it } from 'vitest';

import type { HideActionState } from '@/app/admin/(shell)/productos/actions';
import { hideReadKey, shownHideFacts, type HideFacts } from '@/components/admin/hide-toggle-state';

// US-2.5 (T-2.5.3b), AC 28 and 29 on the screen side (03-ux contract note 4): the toggle shows the action's stored
// answer while the page's read is the one the answer arrived with, and the page's read the moment it changes, also
// when only the reason changed (an offer press can change the product's reason and nothing else). The choice is a pure
// function, so it is proved without a DOM.

const read: HideFacts = { hidden: false, publicNow: false, reason: 'offers_feed_not_approved' };

const done = (overrides: Partial<Extract<HideActionState, { status: 'done' }>> = {}): HideActionState => ({
  status: 'done',
  kind: 'product',
  id: 7,
  hidden: true,
  publicNow: false,
  reason: 'product_hidden',
  ...overrides,
});

describe('hideReadKey (AC 29)', () => {
  it('differs for each of the three facts, the reason alone included, and is equal for equal facts', () => {
    const base = hideReadKey(read);
    expect(hideReadKey({ ...read })).toBe(base);
    expect(hideReadKey({ ...read, hidden: true })).not.toBe(base);
    expect(hideReadKey({ ...read, publicNow: true })).not.toBe(base);
    expect(hideReadKey({ ...read, reason: 'offers_hidden' })).not.toBe(base);
    expect(hideReadKey({ ...read, reason: null })).not.toBe(base);
  });

  it('keeps a missing reason apart from every code, so a read that gained or lost a reason is a new read', () => {
    const keys = new Set([hideReadKey({ ...read, reason: null }), hideReadKey({ ...read, reason: 'unknown' })]);
    expect(keys.size).toBe(2);
  });
});

describe('shownHideFacts (AC 28, 29)', () => {
  it('shows the answer, with its reason, while the page read is the one the answer arrived with', () => {
    expect(shownHideFacts(done(), 'product', 7, read, hideReadKey(read))).toEqual({
      hidden: true,
      publicNow: false,
      reason: 'product_hidden',
    });
    // An answer that reads Yes carries no reason.
    expect(shownHideFacts(done({ hidden: false, publicNow: true, reason: null }), 'product', 7, read, hideReadKey(read))).toEqual({
      hidden: false,
      publicNow: true,
      reason: null,
    });
  });

  it('shows the page read once it has changed since the answer arrived, when only its reason changed', () => {
    const arrived = hideReadKey(read);
    const refreshed: HideFacts = { ...read, reason: 'offers_hidden' };
    expect(shownHideFacts(done(), 'product', 7, refreshed, arrived)).toEqual(refreshed);
    // The same answer still wins against the read it arrived with, so the switch is the reason's alone.
    expect(shownHideFacts(done(), 'product', 7, read, arrived)).not.toEqual(refreshed);
  });

  it('shows the page read for an answer of another kind or another row, and for no answer, a gone row or a failure', () => {
    const arrived = hideReadKey(read);
    expect(shownHideFacts(done({ kind: 'offer' }), 'product', 7, read, arrived)).toEqual(read);
    expect(shownHideFacts(done({ id: 8 }), 'product', 7, read, arrived)).toEqual(read);
    for (const state of [
      { status: 'idle' },
      { status: 'gone', kind: 'product', id: 7 },
      { status: 'failed', kind: 'product', id: 7 },
    ] as HideActionState[]) {
      expect(shownHideFacts(state, 'product', 7, read, arrived), state.status).toEqual(read);
    }
  });
});
