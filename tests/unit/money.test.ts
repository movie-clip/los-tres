import { describe, expect, it } from 'vitest';

import { formatEuroCents, parseDecimalToCents } from '@/server/money';

import { normaliseSpaces } from '../support/messages';

// Guardrail 4: money is integer cents. Each case below is one where parsing
// through a float rounds wrongly (0.29 * 100 = 28.999999999999996,
// 19.99 * 100 = 1998.9999999999998, 1.1 * 100 = 110.00000000000001,
// 4.35 * 100 = 434.99999999999994).
describe('parseDecimalToCents (C-12, TD-41)', () => {
  it.each([
    ['19.99', 1999],
    ['0.29', 29],
    ['1.1', 110],
    ['12', 1200],
    ['12,5', 1250],
    ['19,99', 1999],
    ['4.35', 435],
    ['0.01', 1],
    ['0,01', 1],
    [' 12.50 ', 1250],
    ['9999999.99', 999999999],
  ])('parses %j to %i cents', (text, cents) => {
    expect(parseDecimalToCents(text)).toBe(cents);
  });

  it.each([
    ['1.005', 'more than two decimals is rejected, never rounded'],
    ['1.234,50', 'a thousands separator'],
    ['1,234.50', 'a thousands separator'],
    ['1e3', 'an exponent'],
    ['-1', 'a sign'],
    ['+1', 'a sign'],
    ['0', 'zero'],
    ['0.00', 'zero'],
    ['', 'blank'],
    [' ', 'blank'],
    ['12.', 'a dangling separator'],
    ['.5', 'no integer part'],
    ['abc', 'text'],
    ['12 EUR', 'a currency suffix'],
    ['99999999', 'more than 7 integer digits (would not fit the integer column)'],
    ['١٢', 'non-ASCII digits'],
  ])('rejects %j (%s)', (text) => {
    expect(parseDecimalToCents(text)).toBeNull();
  });

  it('always returns a safe integer or null', () => {
    for (const text of ['19.99', '0.29', '1.1', '4.35', '123456.78', '7']) {
      const cents = parseDecimalToCents(text);
      expect(Number.isInteger(cents)).toBe(true);
    }
  });
});

describe('formatEuroCents (C-12, TD-34)', () => {
  it('formats 1999 as 19,99 € and 123450 as 1.234,50 € after normalising U+00A0', () => {
    expect(normaliseSpaces(formatEuroCents(1999))).toBe('19,99 €');
    expect(normaliseSpaces(formatEuroCents(123450))).toBe('1.234,50 €');
  });

  it('forces the thousands separator on four digits, which plain es-ES drops', () => {
    expect(normaliseSpaces(formatEuroCents(123450))).toContain('1.234');
  });

  it('puts a non-breaking space before the euro sign', () => {
    expect(formatEuroCents(1999)).toContain(' €');
  });

  it('formats zero and a single cent', () => {
    expect(normaliseSpaces(formatEuroCents(0))).toBe('0,00 €');
    expect(normaliseSpaces(formatEuroCents(1))).toBe('0,01 €');
  });

  it.each([1.5, 0.1, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for %s',
    (cents) => {
      expect(() => formatEuroCents(cents)).toThrow(RangeError);
    },
  );

  it('round-trips what the parser produces', () => {
    for (const text of ['19.99', '0.29', '1.10', '4.35']) {
      const cents = parseDecimalToCents(text);
      expect(cents).not.toBeNull();
      expect(normaliseSpaces(formatEuroCents(cents as number))).toBe(`${text.replace('.', ',')} €`);
    }
  });
});
