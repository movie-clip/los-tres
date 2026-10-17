import { describe, expect, it } from 'vitest';

import { normalizeBrand, normalizePartNumber, parseEan } from '@/server/matching';

// 0008, the slice B cut: EAN, then the normalisers. Brand + part-number
// matching has no code path yet and is tested when it ships.
describe('parseEan', () => {
  it.each([
    ['2000000000015', '2000000000015'],
    ['2000000000022', '2000000000022'],
    ['2000000000039', '2000000000039'],
    ['2000000000046', '2000000000046'],
    ['2000000000053', '2000000000053'],
    ['2000000000060', '2000000000060'],
    ['4006381333931', '4006381333931'],
    ['20000004', '20000004'],
    ['73513537', '73513537'],
  ])('accepts the GTIN %s', (raw, normalised) => {
    expect(parseEan(raw)).toEqual({ kind: 'valid', normalised });
  });

  it('strips spaces and hyphens before validating', () => {
    expect(parseEan(' 2000 0000 00015 ')).toEqual({ kind: 'valid', normalised: '2000000000015' });
    expect(parseEan('200-0000-000015')).toEqual({ kind: 'valid', normalised: '2000000000015' });
  });

  it('does not pad: the normalised value is the digit string as given', () => {
    expect(parseEan('20000004')).toEqual({ kind: 'valid', normalised: '20000004' });
  });

  it.each([null, undefined, '', '   ', '\t'])('treats %j as absent', (raw) => {
    expect(parseEan(raw)).toEqual({ kind: 'absent' });
  });

  it.each([
    ['2000000000016', 'a bad check digit (13)'],
    ['20000005', 'a bad check digit (8)'],
    ['200000000001', 'length 12'],
    ['20000000000150', 'length 14'],
    ['2000000', 'length 7'],
    ['200000000001X', 'a letter'],
    ['2000000000015.0', 'a decimal point'],
    ['2e12', 'an exponent'],
  ])('rejects %j: %s', (raw) => {
    expect(parseEan(raw)).toEqual({ kind: 'invalid' });
  });
});

describe('normalizePartNumber', () => {
  it('removes spaces, hyphens and dots and upper-cases', () => {
    expect(normalizePartNumber('0 986 494 123')).toBe('0986494123');
    expect(normalizePartNumber('0986494123')).toBe('0986494123');
    expect(normalizePartNumber('oc-12.34')).toBe('OC1234');
  });

  it('makes OC 1234 and OC-1234 equal', () => {
    expect(normalizePartNumber('OC 1234')).toBe(normalizePartNumber('OC-1234'));
  });

  it.each([null, undefined, '', '  ', '- . -'])('gives null for %j', (raw) => {
    expect(normalizePartNumber(raw)).toBeNull();
  });
});

describe('normalizeBrand', () => {
  it('trims, collapses inner whitespace and upper-cases', () => {
    expect(normalizeBrand('  Marca   Demo ')).toBe('MARCA DEMO');
    expect(normalizeBrand('marcademo')).toBe(normalizeBrand('MarcaDemo'));
  });

  it('keeps hyphens (a brand is not a part number)', () => {
    expect(normalizeBrand('Black-Decker')).toBe('BLACK-DECKER');
  });

  it.each([null, undefined, '', '   '])('gives null for %j', (raw) => {
    expect(normalizeBrand(raw)).toBeNull();
  });
});
