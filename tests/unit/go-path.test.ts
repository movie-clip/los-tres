import { describe, expect, it } from 'vitest';

import { goPath, parseOfferParam } from '@/server/clicks/go-path';

describe('goPath', () => {
  it('builds /go/<id>', () => {
    expect(goPath(12)).toBe('/go/12');
  });

  it.each([0, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError for %s', (id) => {
    expect(() => goPath(id)).toThrow(RangeError);
  });
});

describe('parseOfferParam', () => {
  it.each([
    ['1', 1],
    ['12', 12],
    ['999999999', 999999999],
  ])('accepts %s', (raw, id) => {
    expect(parseOfferParam(raw)).toBe(id);
  });

  it.each(['0', '01', '-1', '1.5', '1e3', ' 1', '1 ', 'abc', '', '1000000000', '0x10', '+1', '1\n'])(
    'rejects %j',
    (raw) => {
      expect(parseOfferParam(raw)).toBeNull();
    },
  );

  it('round-trips with goPath', () => {
    expect(parseOfferParam(goPath(345).replace('/go/', ''))).toBe(345);
  });
});
