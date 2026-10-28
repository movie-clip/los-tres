import { describe, expect, it } from 'vitest';

import { bestPriceFlags } from '@/server/catalogue/best-price';

// The "Mejor precio" rule (D-1): flag every offer at the lowest price, but
// only when the prices hold at least two distinct values. By value, not position.

describe('bestPriceFlags (D-1)', () => {
  it('flags nothing for a single offer', () => {
    expect(bestPriceFlags([1049])).toEqual([false]);
  });

  it('flags nothing when every offer has the same price', () => {
    expect(bestPriceFlags([1049, 1049, 1049])).toEqual([false, false, false]);
  });

  it('flags nothing for two equal prices', () => {
    expect(bestPriceFlags([500, 500])).toEqual([false, false]);
  });

  it('flags every offer tied at the lowest price when a dearer one exists', () => {
    expect(bestPriceFlags([1049, 1049, 1130])).toEqual([true, true, false]);
  });

  it('flags only the first of four distinct prices given cheapest first', () => {
    expect(bestPriceFlags([1195, 1295, 1395, 1530])).toEqual([true, false, false, false]);
  });

  it('flags by value, not by position, when the cheaper price comes later', () => {
    expect(bestPriceFlags([1299, 1149])).toEqual([false, true]);
  });

  it('does not flag a second-lowest price tied among itself', () => {
    expect(bestPriceFlags([900, 1000, 1000])).toEqual([true, false, false]);
  });

  it('keeps the input length and order, and an empty input gives an empty result', () => {
    expect(bestPriceFlags([])).toEqual([]);
    expect(bestPriceFlags([3, 1, 2, 1])).toHaveLength(4);
    expect(bestPriceFlags([3, 1, 2, 1])).toEqual([false, true, false, true]);
  });

  it('compares integer cents exactly, one cent apart', () => {
    expect(bestPriceFlags([1999, 2000])).toEqual([true, false]);
  });
});
