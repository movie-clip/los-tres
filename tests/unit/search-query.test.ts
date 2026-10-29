import { describe, expect, it } from 'vitest';

import { eanCandidate, parseSearchTerm, SEARCH_TERM_MAX_LENGTH } from '@/server/catalogue/search-query';

// S5.4, AC 10 (term cleaning), AC 5 (EAN candidate), AC 11 (control characters).

describe('parseSearchTerm (AC 10)', () => {
  it('returns an empty term for no value, an empty string and whitespace only', () => {
    expect(parseSearchTerm(undefined)).toBe('');
    expect(parseSearchTerm('')).toBe('');
    expect(parseSearchTerm('   \t\n  ')).toBe('');
    expect(parseSearchTerm([])).toBe('');
  });

  it('trims the ends and collapses inner runs of whitespace to one space', () => {
    expect(parseSearchTerm('  aceite   sintético \t 5W-30\n')).toBe('aceite sintético 5W-30');
  });

  it('uses the first value when q is given more than once', () => {
    expect(parseSearchTerm(['filtro', 'aceite'])).toBe('filtro');
    expect(parseSearchTerm(['  filtro  ', 'aceite'])).toBe('filtro');
    expect(parseSearchTerm(['', 'aceite'])).toBe('');
  });

  it('turns every C0 and C1 control character, NUL included, into a space (AC 11)', () => {
    expect(parseSearchTerm('a\u0000b')).toBe('a b');
    expect(parseSearchTerm('a\u0007b\u001fc\u007fd\u0085e\u009ff')).toBe('a b c d e f');
    expect(parseSearchTerm('\u0000')).toBe('');
    expect(parseSearchTerm('\u0000\u0000filtro\u0000')).toBe('filtro');
  });

  it('keeps hostile punctuation as typed, for the loader to treat as plain text', () => {
    for (const term of ['%', '_', '&|!:(', '\\', "'", '"', 'a:*', '😀']) {
      expect(parseSearchTerm(term)).toBe(term);
    }
  });

  it('keeps a term of exactly the maximum length and cuts a longer one', () => {
    expect(SEARCH_TERM_MAX_LENGTH).toBe(100);
    const exact = 'a'.repeat(100);
    expect(parseSearchTerm(exact)).toBe(exact);
    expect(parseSearchTerm('a'.repeat(101))).toBe(exact);
    expect(parseSearchTerm('a'.repeat(5000))).toHaveLength(100);
  });

  it('cuts by code points, never splitting a surrogate pair', () => {
    expect(parseSearchTerm('😀'.repeat(150))).toBe('😀'.repeat(100));
    const straddle = parseSearchTerm(`${'a'.repeat(99)}😀tail`);
    expect(straddle).toBe(`${'a'.repeat(99)}😀`);
    expect(Array.from(straddle)).toHaveLength(100);
  });

  it('trims again after the cut, so no trailing space survives', () => {
    expect(parseSearchTerm(`${'a'.repeat(99)} bbb`)).toBe('a'.repeat(99));
  });

  it('does not throw for any input shape', () => {
    for (const value of [undefined, '', [], ['x'], '\u0000', '😀', 'a'.repeat(100000)]) {
      expect(() => parseSearchTerm(value)).not.toThrow();
    }
  });
});

describe('eanCandidate (AC 5)', () => {
  it('returns the digits for an 8 or 13 digit term, with spaces, hyphens and dots removed', () => {
    expect(eanCandidate('8410076472540')).toBe('8410076472540');
    expect(eanCandidate('8 410076 472540')).toBe('8410076472540');
    expect(eanCandidate('8410076-472540')).toBe('8410076472540');
    expect(eanCandidate('8410076.472540')).toBe('8410076472540');
    expect(eanCandidate('96385074')).toBe('96385074');
    expect(eanCandidate('9638-5074')).toBe('96385074');
  });

  it('returns null for any other digit count', () => {
    for (const term of ['', '1234567', '123456789', '123456789012', '12345678901234']) {
      expect(eanCandidate(term)).toBeNull();
    }
  });

  it('returns null when anything but digits, spaces, hyphens and dots is present', () => {
    for (const term of ['84100764725AB', '8410076 472540 x', 'OC-1234', '8410076_472540', '+8410076472540']) {
      expect(eanCandidate(term)).toBeNull();
    }
  });

  it('does not test the check digit: equality with a stored value is the check', () => {
    expect(eanCandidate('1234567890123')).toBe('1234567890123');
  });
});
