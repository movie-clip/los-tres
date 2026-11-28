import { describe, expect, it } from 'vitest';

import type { AttributeKey, AttributeValues } from '@/server/category-attributes';
import { decideAttributeFill, readsAnyAttribute, type AttributeFillFacts, type AttributeFillSkip } from '@/server/importer/attribute-fill';
import { decideEanFill, fillGate, type EanFillFacts, type FillGateFacts, type FillGateSkip } from '@/server/importer/ean-fill';

// S15.3 (US-15.3) ACs 23 to 35: the one statement of the attribute-fill rule, decided from what the
// importer already read, and the S7.6 gate both fills share (D7). The database half (the write, the
// COALESCE, the transaction) is the integration suite's. Each case starts from an eligible row and
// changes only what it is about, so a skip names exactly one fact.

const NONE: AttributeValues = { viscosity: null, volumeMl: null, acea: null, oilType: null, approvals: null };
const ALL: AttributeValues = {
  viscosity: '10W-40',
  volumeMl: 4000,
  acea: ['A3/B4', 'C2'],
  oilType: 'synthetic',
  approvals: ['VW 504 00', 'VW 507 00'],
};
const NOT_HELD: Record<AttributeKey, boolean> = { viscosity: false, volume: false, acea: false, oilType: false, approvals: false };
const ALL_HELD: Record<AttributeKey, boolean> = { viscosity: true, volume: true, acea: true, oilType: true, approvals: true };

type Change = {
  row?: Partial<AttributeValues>;
  held?: Partial<Record<AttributeKey, boolean>>;
  product?: { isHidden?: boolean; marked?: boolean };
  offer?: Partial<AttributeFillFacts['offer']>;
  markedRow?: boolean;
  shopApproved?: boolean;
  feedApproved?: boolean;
};

/** A row that fills: all five readable, an unmarked row on an unmarked, visible product that holds none, everything approved. */
function eligible(change: Change = {}): AttributeFillFacts {
  return {
    row: { ...ALL, ...change.row },
    markedRow: change.markedRow ?? false,
    shopApproved: change.shopApproved ?? true,
    feedApproved: change.feedApproved ?? true,
    offer: { isHidden: false, inReview: false, ...change.offer },
    product: { isHidden: false, marked: false, ...change.product, held: { ...NOT_HELD, ...change.held } },
  };
}

const skip = (reason: AttributeFillSkip) => ({ kind: 'skip', reason });

/** A row that read nothing: `eligible` spreads ALL under `change.row`, so every key is set null. */
const NO_VALUES: Change = { row: { viscosity: null, volumeMl: null, acea: null, oilType: null, approvals: null } };

/** One fact against the fill, by the reason it must give; the checks run in this order. */
const AGAINST: [AttributeFillSkip, Change][] = [
  ['no_values', NO_VALUES],
  ['nothing_absent', { held: ALL_HELD }],
  ['other_side', { product: { marked: true } }],
  ['feed_not_approved', { feedApproved: false }],
  ['shop_not_approved', { shopApproved: false }],
  ['offer_hidden', { offer: { isHidden: true } }],
  ['offer_in_review', { offer: { inReview: true } }],
  ['product_hidden', { product: { isHidden: true } }],
];

function both(a: Change, b: Change): AttributeFillFacts {
  return eligible({
    ...a,
    ...b,
    row: { ...a.row, ...b.row },
    held: { ...a.held, ...b.held },
    product: { ...a.product, ...b.product },
    offer: { ...a.offer, ...b.offer },
  });
}

describe('readsAnyAttribute', () => {
  it('is false for a row that read nothing and true when any one of the five read', () => {
    expect(readsAnyAttribute(NONE)).toBe(false);
    expect(readsAnyAttribute(ALL)).toBe(true);
    expect(readsAnyAttribute({ ...NONE, viscosity: '5W-30' })).toBe(true);
    expect(readsAnyAttribute({ ...NONE, volumeMl: 100 })).toBe(true);
    expect(readsAnyAttribute({ ...NONE, acea: ['C2'] })).toBe(true);
    expect(readsAnyAttribute({ ...NONE, oilType: 'mineral' })).toBe(true);
    expect(readsAnyAttribute({ ...NONE, approvals: ['x'] })).toBe(true);
  });
});

describe('decideAttributeFill: the fill (AC 23, 26, 27)', () => {
  it('fills every attribute the row read when the product holds none, whole', () => {
    expect(decideAttributeFill(eligible())).toEqual({ kind: 'fill', values: ALL });
  });

  it('fills one by one (AC 26): only the attributes the product does not hold, never the held one', () => {
    expect(decideAttributeFill(eligible({ held: { viscosity: true } }))).toEqual({
      kind: 'fill',
      values: { volumeMl: 4000, acea: ['A3/B4', 'C2'], oilType: 'synthetic', approvals: ['VW 504 00', 'VW 507 00'] },
    });
    expect(decideAttributeFill(eligible({ row: { viscosity: '5W-30', volumeMl: 5000 }, held: { viscosity: true } }))).toMatchObject({
      kind: 'fill',
      values: { volumeMl: 5000 },
    });
  });

  it('never names a key the row did not read, so a blank or an unreadable cell fills nothing (AC 24)', () => {
    const decision = decideAttributeFill(eligible({ row: { ...NO_VALUES.row, oilType: 'mineral' } }));
    expect(decision).toEqual({ kind: 'fill', values: { oilType: 'mineral' } });
  });

  it('fills a set as a whole or not at all (AC 27): a held ACEA set is never offered the row\'s other or longer set', () => {
    const decision = decideAttributeFill(eligible({ row: { acea: ['A3/B4', 'C2', 'C3'] }, held: { acea: true, approvals: true } }));
    expect(decision).toMatchObject({ kind: 'fill' });
    expect(decision.kind === 'fill' ? Object.keys(decision.values).sort() : []).toEqual(['oilType', 'viscosity', 'volumeMl']);
  });

  it('fills for a marked row on a marked product, the same side (AC 32)', () => {
    expect(decideAttributeFill(eligible({ markedRow: true, product: { marked: true } }))).toMatchObject({ kind: 'fill' });
  });

  it('is gated by the facts of the row, not by its category: no category fact exists (D-26)', () => {
    const facts = eligible();
    expect(Object.keys(facts).sort()).toEqual(['feedApproved', 'markedRow', 'offer', 'product', 'row', 'shopApproved']);
  });
});

describe('decideAttributeFill: each refusal on its own', () => {
  it.each<[string, Change, AttributeFillSkip]>([
    ['the row read nothing (AC 24: a blank or an unreadable value fills nothing)', NO_VALUES, 'no_values'],
    ['the product holds every attribute the row read (AC 25)', { held: ALL_HELD }, 'nothing_absent'],
    [
      'the product holds the only attribute the row read',
      { row: { ...NO_VALUES.row, acea: ['C2'] }, held: { acea: true } },
      'nothing_absent',
    ],
    ['a marked row meets an unmarked product (AC 33)', { markedRow: true, product: { marked: false } }, 'other_side'],
    ['an unmarked row meets a marked product (AC 34)', { markedRow: false, product: { marked: true } }, 'other_side'],
    ['the feed is not approved (AC 30)', { feedApproved: false }, 'feed_not_approved'],
    ['the shop is not approved (AC 30)', { shopApproved: false }, 'shop_not_approved'],
    ['the offer is hidden (AC 30)', { offer: { isHidden: true } }, 'offer_hidden'],
    ['the offer is in review (AC 30)', { offer: { inReview: true } }, 'offer_in_review'],
    ['the product is hidden (AC 30)', { product: { isHidden: true } }, 'product_hidden'],
  ])('skips when %s', (_label, change, reason) => {
    expect(decideAttributeFill(eligible(change))).toEqual(skip(reason));
  });

  it('is reached once per reason: all eight reasons are covered by the table', () => {
    expect(AGAINST.map(([, change]) => decideAttributeFill(eligible(change)))).toEqual(AGAINST.map(([reason]) => skip(reason)));
    expect(new Set(AGAINST.map(([reason]) => reason)).size).toBe(8);
  });
});

describe('decideAttributeFill: the order of the checks, the first that holds is the reason', () => {
  const pairs = AGAINST.flatMap(([earlier, a], i) => AGAINST.slice(i + 1).map(([later, b]) => [earlier, later, a, b] as const));

  it.each(pairs)('%s comes before %s', (earlier, _later, a, b) => {
    expect(decideAttributeFill(both(a, b))).toEqual(skip(earlier));
    expect(decideAttributeFill(both(b, a))).toEqual(skip(earlier));
  });

  it('a hidden product that holds everything the row read says nothing_absent, not product_hidden: the gate is last', () => {
    expect(decideAttributeFill(eligible({ held: ALL_HELD, product: { isHidden: true } }))).toEqual(skip('nothing_absent'));
  });
});

describe('decideAttributeFill: it is a function of the facts alone', () => {
  it('returns equal decisions for equal facts and leaves them unchanged', () => {
    const facts = eligible({ held: { oilType: true } });
    const snapshot = JSON.parse(JSON.stringify(facts)) as AttributeFillFacts;
    expect(decideAttributeFill(facts)).toEqual(decideAttributeFill(eligible({ held: { oilType: true } })));
    expect(facts).toEqual(snapshot);
  });
});

describe('fillGate: the one S7.6 eligibility, shared by both fills (D7, AC 44)', () => {
  const gateFacts = (change: Omit<Change, 'row' | 'held'> = {}): FillGateFacts => ({
    markedRow: change.markedRow ?? false,
    shopApproved: change.shopApproved ?? true,
    feedApproved: change.feedApproved ?? true,
    offer: { isHidden: false, inReview: false, ...change.offer },
    product: { isHidden: false, marked: false, ...change.product },
  });

  it('is null for an eligible row and names the first failed condition otherwise, in the order of FillGateSkip', () => {
    expect(fillGate(gateFacts())).toBeNull();
    const cases: [FillGateSkip, Omit<Change, 'row' | 'held'>][] = [
      ['other_side', { product: { marked: true } }],
      ['feed_not_approved', { feedApproved: false }],
      ['shop_not_approved', { shopApproved: false }],
      ['offer_hidden', { offer: { isHidden: true } }],
      ['offer_in_review', { offer: { inReview: true } }],
      ['product_hidden', { product: { isHidden: true } }],
    ];
    for (const [reason, change] of cases) expect(fillGate(gateFacts(change))).toBe(reason);
    // Everything at once: the first of the order.
    expect(
      fillGate(gateFacts({ product: { marked: true, isHidden: true }, feedApproved: false, shopApproved: false, offer: { isHidden: true, inReview: true } })),
    ).toBe('other_side');
  });

  it('is the gate the EAN fill uses: the same facts give the same reason in both fills, and the EAN fill is unchanged', () => {
    const eanFacts = (change: Omit<Change, 'row' | 'held'>): EanFillFacts => ({
      ...gateFacts(change),
      row: { ean: '2000000000046', eanNormalised: '2000000000046' },
      product: { ean: null, eanNormalised: null, isHidden: change.product?.isHidden ?? false, marked: change.product?.marked ?? false },
    });
    for (const change of [{ shopApproved: false }, { feedApproved: false }, { offer: { inReview: true } }, { product: { isHidden: true } }, { markedRow: true }]) {
      const gate = fillGate(gateFacts(change));
      expect(decideEanFill(eanFacts(change))).toEqual({ kind: 'skip', reason: gate });
      expect(decideAttributeFill(eligible(change))).toEqual({ kind: 'skip', reason: gate });
    }
    expect(decideEanFill(eanFacts({}))).toEqual({ kind: 'try', ean: '2000000000046', eanNormalised: '2000000000046' });
  });

  it('reads raw approval, hide and review states only: its facts name no local flag and no visibility scope', () => {
    expect(Object.keys(gateFacts()).sort()).toEqual(['feedApproved', 'markedRow', 'offer', 'product', 'shopApproved']);
  });
});
