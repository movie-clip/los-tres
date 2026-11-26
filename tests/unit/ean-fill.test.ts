import { describe, expect, it } from 'vitest';

import { decideEanFill, type EanFillFacts, type EanFillSkip } from '@/server/importer/ean-fill';

// S7.6 (US-7.6): the one statement of the EAN-fill rule, decided from what the importer already read.
// The holder refusal (AC 12, 13) needs the database and is the integration suite's. Each case below
// starts from an eligible row and changes only what it is about, so a skip names exactly one fact.

type Change = {
  row?: Partial<EanFillFacts['row']>;
  product?: Partial<EanFillFacts['product']>;
  offer?: Partial<EanFillFacts['offer']>;
  markedRow?: boolean;
  shopApproved?: boolean;
  feedApproved?: boolean;
};

/** A row that fills: valid EAN, an unmarked row on an unmarked product with no EAN, everything approved. */
function eligible(change: Change = {}): EanFillFacts {
  return {
    row: { ean: '2000 0000 00046', eanNormalised: '2000000000046', ...change.row },
    markedRow: change.markedRow ?? false,
    shopApproved: change.shopApproved ?? true,
    feedApproved: change.feedApproved ?? true,
    offer: { isHidden: false, inReview: false, ...change.offer },
    product: { ean: null, eanNormalised: null, isHidden: false, marked: false, ...change.product },
  };
}

const SET = { ean: '2000000000053', eanNormalised: '2000000000053' };

/** One fact against the fill, by the reason it must give; the checks run in this order of keys. */
const AGAINST: [EanFillSkip, Change][] = [
  ['no_ean', { row: { ean: null, eanNormalised: null } }],
  ['product_has_ean', { product: SET }],
  ['other_side', { product: { marked: true } }],
  ['feed_not_approved', { feedApproved: false }],
  ['shop_not_approved', { shopApproved: false }],
  ['offer_hidden', { offer: { isHidden: true } }],
  ['offer_in_review', { offer: { inReview: true } }],
  ['product_hidden', { product: { isHidden: true } }],
];

/** Both changes at once. */
function both(a: Change, b: Change): EanFillFacts {
  return eligible({
    ...a,
    ...b,
    row: { ...a.row, ...b.row },
    product: { ...a.product, ...b.product },
    offer: { ...a.offer, ...b.offer },
  });
}

const skip = (reason: EanFillSkip) => ({ kind: 'skip', reason });

describe('decideEanFill: the fill (AC 1, 2)', () => {
  it("tries the row's own two values, the cell as written and its digit form", () => {
    expect(decideEanFill(eligible())).toEqual({ kind: 'try', ean: '2000 0000 00046', eanNormalised: '2000000000046' });
  });

  it('tries for a marked row on a marked product, the same side (AC 8)', () => {
    expect(decideEanFill(eligible({ markedRow: true, product: { marked: true } }))).toMatchObject({ kind: 'try' });
  });
});

describe('decideEanFill: each refusal on its own', () => {
  it.each<[string, Change, EanFillSkip]>([
    ['the row carries no EAN at all (AC 14)', { row: { ean: null, eanNormalised: null } }, 'no_ean'],
    ['the row has the cell but no digit form', { row: { eanNormalised: null } }, 'no_ean'],
    ['the row has the digit form but no cell', { row: { ean: null } }, 'no_ean'],
    ['the product already has an EAN (AC 15)', { product: SET }, 'product_has_ean'],
    ['the product has only the cell set (DT-4)', { product: { ean: SET.ean } }, 'product_has_ean'],
    ['the product has only the digit form set (DT-4)', { product: { eanNormalised: SET.eanNormalised } }, 'product_has_ean'],
    ['a marked row meets an unmarked product (AC 9)', { markedRow: true, product: { marked: false } }, 'other_side'],
    ['an unmarked row meets a marked product (AC 10)', { markedRow: false, product: { marked: true } }, 'other_side'],
    ['the feed is not approved (AC 6)', { feedApproved: false }, 'feed_not_approved'],
    ['the shop is not approved (AC 6)', { shopApproved: false }, 'shop_not_approved'],
    ['the offer is hidden (AC 6)', { offer: { isHidden: true } }, 'offer_hidden'],
    ['the offer is in review (AC 6)', { offer: { inReview: true } }, 'offer_in_review'],
    ['the product is hidden (AC 6, D-13)', { product: { isHidden: true } }, 'product_hidden'],
  ])('skips when %s', (_label, change, reason) => {
    expect(decideEanFill(eligible(change))).toEqual(skip(reason));
  });

  it('is reached once per reason: all eight reasons are covered by the table above', () => {
    expect(AGAINST.map(([, change]) => decideEanFill(eligible(change)))).toEqual(AGAINST.map(([reason]) => skip(reason)));
    expect(new Set(AGAINST.map(([reason]) => reason)).size).toBe(8);
  });
});

describe('decideEanFill: the order of the checks, the first that holds is the reason', () => {
  const pairs = AGAINST.flatMap(([earlier, a], i) =>
    AGAINST.slice(i + 1).map(([later, b]) => [earlier, later, a, b] as const),
  );

  it.each(pairs)('%s comes before %s', (earlier, _later, a, b) => {
    expect(decideEanFill(both(a, b))).toEqual(skip(earlier));
    // And the other way round is the same decision: the order is the rule's, not the arguments'.
    expect(decideEanFill(both(b, a))).toEqual(skip(earlier));
  });

  it('reports no_ean when every fact is against the fill', () => {
    const all = AGAINST.reduce<EanFillFacts>((facts, [, change]) => both(facts, change), eligible());
    expect(decideEanFill(all)).toEqual(skip('no_ean'));
  });
});

describe('decideEanFill: it is a function of the facts alone', () => {
  it('returns equal decisions for equal facts and leaves them unchanged', () => {
    const facts = eligible({ shopApproved: false });
    const snapshot = JSON.parse(JSON.stringify(facts)) as EanFillFacts;
    expect(decideEanFill(facts)).toEqual(decideEanFill(eligible({ shopApproved: false })));
    expect(facts).toEqual(snapshot);
  });
});
