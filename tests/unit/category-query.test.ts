import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CATEGORY_SORT,
  brandSlug,
  parseBrandParam,
  parseSortParam,
  sortParamValue,
  type CategorySort,
} from '@/server/catalogue/category-query';

// S11.4 (04-design § Query param parsing, § Brand slug and label). Malformed
// input is ignored, never thrown: the parsers sit in front of a public URL.

const SORTS: CategorySort[] = ['price-asc', 'price-desc', 'name'];

describe('the sort URL table', () => {
  it('maps each sort to its public value', () => {
    expect(sortParamValue('price-asc')).toBe('precio-asc');
    expect(sortParamValue('price-desc')).toBe('precio-desc');
    expect(sortParamValue('name')).toBe('nombre');
  });

  it.each(SORTS)('round-trips %s through its URL value', (sort) => {
    expect(parseSortParam(sortParamValue(sort))).toBe(sort);
  });

  it('has one distinct URL value per sort', () => {
    expect(new Set(SORTS.map(sortParamValue)).size).toBe(SORTS.length);
  });

  it('names price-asc as the default', () => {
    expect(DEFAULT_CATEGORY_SORT).toBe('price-asc');
  });
});

describe('parseSortParam', () => {
  it('reads the three URL values', () => {
    expect(parseSortParam('precio-asc')).toBe('price-asc');
    expect(parseSortParam('precio-desc')).toBe('price-desc');
    expect(parseSortParam('nombre')).toBe('name');
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['unknown', 'zzz'],
    ['the code name, not the URL value', 'price-desc'],
    ['upper case', 'NOMBRE'],
    ['padded', ' nombre'],
    ['repeated', ['nombre', 'precio-desc']],
    ['a single-item array', ['nombre']],
    ['an empty array', []],
    ['a prototype key', '__proto__'],
    ['a long string', 'x'.repeat(10_000)],
  ] as const)('falls back to the default for %s', (_name, value) => {
    expect(parseSortParam(value as string | string[] | undefined)).toBe(DEFAULT_CATEGORY_SORT);
  });
});

describe('parseBrandParam', () => {
  it.each(['bosch', 'mann-filter', 'liqui-moly', 'a', '0', '3m', 'a-b-c-1'])('accepts %s as it is', (value) => {
    expect(parseBrandParam(value)).toBe(value);
  });

  it('accepts exactly 64 characters and refuses 65', () => {
    expect(parseBrandParam('a'.repeat(64))).toBe('a'.repeat(64));
    expect(parseBrandParam('a'.repeat(65))).toBeNull();
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['upper case', 'Bosch'],
    ['punctuation', '!!'],
    ['a space', 'mann filter'],
    ['an accent', 'ñandú'],
    ['an underscore', 'a_b'],
    ['a leading hyphen', '-bosch'],
    ['a trailing hyphen', 'bosch-'],
    ['a double hyphen', 'a--b'],
    ['a slash', 'a/b'],
    ['a percent escape', 'a%20b'],
    ['repeated', ['bosch', 'mahle']],
    ['a single-item array', ['bosch']],
    ['an empty array', []],
    ['a very long string', 'a'.repeat(10_000)],
  ] as const)('ignores %s: null, no throw', (_name, value) => {
    expect(parseBrandParam(value as string | string[] | undefined)).toBeNull();
  });
});

describe('brandSlug', () => {
  it('slugs a normalised brand like a title', () => {
    expect(brandSlug('BOSCH')).toBe('bosch');
    expect(brandSlug('MANN-FILTER')).toBe('mann-filter');
    expect(brandSlug('LIQUI MOLY')).toBe('liqui-moly');
  });

  it('strips accents', () => {
    expect(brandSlug('CITROËN')).toBe('citroen');
  });

  it('merges spellings that differ only in separators', () => {
    expect(brandSlug('A B')).toBe('a-b');
    expect(brandSlug('A-B')).toBe('a-b');
    expect(brandSlug('A.B')).toBe('a-b');
  });

  it.each(['', '!!!', '日本語', '---'])('is null, not a fallback, when nothing is left of %j', (value) => {
    expect(brandSlug(value)).toBeNull();
  });

  it('cuts to 64 characters and never ends in a hyphen', () => {
    const slug = brandSlug(`${'a'.repeat(63)} bbbb`);
    expect(slug).toBe('a'.repeat(63));
    expect(brandSlug('x'.repeat(200))).toHaveLength(64);
  });

  it('always yields a string parseBrandParam accepts', () => {
    for (const value of ['BOSCH', 'A  B', 'ÑANDÚ 3M', 'x'.repeat(200), 'a-'.repeat(60)]) {
      const slug = brandSlug(value);
      expect(slug).not.toBeNull();
      expect(parseBrandParam(slug as string)).toBe(slug);
    }
  });
});
