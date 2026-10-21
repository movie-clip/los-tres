import { describe, expect, it } from 'vitest';

import { parsePageParam } from '@/server/catalogue/page-param';

// C-4: `?pagina` to a page number >= 1. It never throws and never redirects;
// the read function decides whether a number is past the last page.

describe('parsePageParam (C-4)', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['abc', 1],
    ['-1', 1],
    ['1.5', 1],
    [' 2', 1],
    ['2 ', 1],
    ['+2', 1],
    ['1e3', 1],
    ['0', 1],
    ['00', 1],
    ['1', 1],
    ['2', 2],
    ['02', 2],
    ['24', 24],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('reads %j as page %d', (value, page) => {
    expect(parsePageParam(value)).toBe(page);
  });

  it('reads a repeated parameter (an array) as page 1', () => {
    expect(parsePageParam(['2', '3'])).toBe(1);
    expect(parsePageParam([])).toBe(1);
  });

  it('caps a value past the safe integer range instead of losing precision', () => {
    expect(parsePageParam('9'.repeat(400))).toBe(Number.MAX_SAFE_INTEGER);
    expect(parsePageParam('9007199254740993')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('always returns a safe integer >= 1', () => {
    for (const value of [undefined, '', 'x', '0', '7', '9'.repeat(30), ['1']]) {
      const page = parsePageParam(value as string | string[] | undefined);
      expect(Number.isSafeInteger(page)).toBe(true);
      expect(page).toBeGreaterThanOrEqual(1);
    }
  });
});
