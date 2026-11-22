import { describe, expect, it } from 'vitest';

import {
  decideRemoval,
  REMOVAL_GUARD_MAX_PERCENT,
  REMOVAL_GUARD_MIN_MISSING,
} from '@/server/importer/removal';

// S3.3 removal guard (T3.3.2, AC 9 to 12): the pure rule that decides whether an import removes the
// feed's offers that its file no longer lists. `current` is the feed's live offers before the import,
// `missing` those no accepted row named, `accepted` the distinct ids of accepted rows.

const decide = (current: number, missing: number, accepted: number, allowLargeRemoval = false) =>
  decideRemoval({ current, missing, accepted, allowLargeRemoval });

const REMOVE = { kind: 'remove' } as const;
const NONE = { kind: 'none' } as const;
const SMALL = { kind: 'skip', reason: 'small_import' } as const;
const EMPTY = { kind: 'skip', reason: 'empty_import' } as const;

describe('the guard numbers (D-1, D-2)', () => {
  // The one test that pins the two rulings as numbers; every other test below states its own sizes.
  it('is ten offers missing and more than half of the live offers', () => {
    expect(REMOVAL_GUARD_MIN_MISSING).toBe(10);
    expect(REMOVAL_GUARD_MAX_PERCENT).toBe(50);
  });
});

describe('nothing missing (AC 3)', () => {
  it.each([
    { current: 0, accepted: 0 },
    { current: 0, accepted: 5 },
    { current: 40, accepted: 40 },
    { current: 40, accepted: 60 },
  ])('removes nothing and says nothing with $current live and $accepted accepted', ({ current, accepted }) => {
    expect(decide(current, 0, accepted)).toEqual(NONE);
    expect(decide(current, 0, accepted, true)).toEqual(NONE);
  });
});

describe('boundaries of the small-import guard (AC 11)', () => {
  it('9 missing of 10 removes: under the minimum the guard never trips', () => {
    expect(decide(10, 9, 1)).toEqual(REMOVE);
  });

  it('10 missing of 20 removes: exactly half is not more than half', () => {
    expect(decide(20, 10, 10)).toEqual(REMOVE);
  });

  it('10 missing of 19 skips: more than half, and at the minimum', () => {
    expect(decide(19, 10, 9)).toEqual(SMALL);
  });

  it('10 missing of 10 skips, and 11 of 20 skips', () => {
    expect(decide(10, 10, 5)).toEqual(SMALL);
    expect(decide(20, 11, 9)).toEqual(SMALL);
  });

  it('50 of 100 removes and 51 of 100 skips: the share is compared exactly, with no rounding', () => {
    expect(decide(100, 50, 50)).toEqual(REMOVE);
    expect(decide(100, 51, 49)).toEqual(SMALL);
  });

  it('a feed with fewer live offers than the minimum is never blocked, even when every offer is missing', () => {
    expect(decide(9, 9, 1)).toEqual(REMOVE);
    expect(decide(5, 5, 3)).toEqual(REMOVE);
    expect(decide(1, 1, 1)).toEqual(REMOVE);
  });

  it('a large feed losing a small share removes', () => {
    expect(decide(100000, 10, 99990)).toEqual(REMOVE);
    expect(decide(100000, 49999, 50001)).toEqual(REMOVE);
  });
});

describe('the override lifts the small-import guard only (AC 12, D-3)', () => {
  it('10 missing of 19 with the override removes', () => {
    expect(decide(19, 10, 9, true)).toEqual(REMOVE);
  });

  it('10 missing of 10 with the override removes', () => {
    expect(decide(10, 10, 5, true)).toEqual(REMOVE);
  });

  it('is not needed where the guard would not trip: the answer is the same with and without it', () => {
    expect(decide(10, 9, 1, true)).toEqual(decide(10, 9, 1, false));
    expect(decide(20, 10, 10, true)).toEqual(decide(20, 10, 10, false));
  });
});

describe('an import with nothing accepted never removes (AC 9)', () => {
  it.each([
    { current: 1, missing: 1 },
    { current: 5, missing: 5 },
    { current: 100, missing: 100 },
    { current: 100, missing: 3 },
    { current: 100000, missing: 100000 },
  ])('skips empty_import for $missing missing of $current, with or without the override', ({ current, missing }) => {
    expect(decide(current, missing, 0)).toEqual(EMPTY);
    expect(decide(current, missing, 0, true)).toEqual(EMPTY);
  });

  it('names empty_import before small_import when both would apply', () => {
    expect(decide(30, 30, 0)).toEqual(EMPTY);
  });

  it('one accepted row is enough to leave the empty case', () => {
    expect(decide(5, 4, 1)).toEqual(REMOVE);
    expect(decide(30, 29, 1)).toEqual(SMALL);
    expect(decide(30, 29, 1, true)).toEqual(REMOVE);
  });
});

describe('the rule is a pure function of its input', () => {
  it('gives the same answer for the same input and does not change it', () => {
    const input = { current: 19, missing: 10, accepted: 9, allowLargeRemoval: false };
    const copy = { ...input };
    expect(decideRemoval(input)).toEqual(decideRemoval(input));
    expect(input).toEqual(copy);
  });
});
