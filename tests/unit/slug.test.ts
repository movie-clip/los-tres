import { describe, expect, it } from 'vitest';

import { slugify, toSlugWords, uniqueSlug } from '@/server/slug';

const FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('slugify (TD-30)', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugify('DEMO Filtro de aceite OC 1234')).toBe('demo-filtro-de-aceite-oc-1234');
    expect(slugify('DEMO Taladro percutor 650 W')).toBe('demo-taladro-percutor-650-w');
  });

  it('strips accents', () => {
    expect(slugify('Aceite sintético ñandú')).toBe('aceite-sintetico-nandu');
  });

  it('turns every run of other characters into one hyphen and trims', () => {
    expect(slugify('  --Llave (12 mm) / "pro"!!  ')).toBe('llave-12-mm-pro');
  });

  it('is at most 80 characters and never ends in a hyphen', () => {
    const slug = slugify(`${'a'.repeat(79)} bbbbbbbb`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });

  it.each(['', '   ', '!!!', '日本語'])('falls back to producto for %j', (title) => {
    expect(slugify(title)).toBe('producto');
  });

  it('always produces a string the products_slug_format check accepts', () => {
    for (const title of ['A', 'a--b', 'Ñ 1', '1', 'x'.repeat(200), 'Árbol/Pieza #5']) {
      expect(slugify(title)).toMatch(FORMAT);
    }
  });
});

describe('toSlugWords (S11.4, the transform slugify and brandSlug share)', () => {
  it('lower-cases, strips accents and hyphenates runs of other characters', () => {
    expect(toSlugWords('  --Ñandú (Pro) / 3M!!  ', 80)).toBe('nandu-pro-3m');
  });

  it('is empty, not a fallback, when nothing is left', () => {
    for (const text of ['', '   ', '!!!', '日本語']) expect(toSlugWords(text, 80)).toBe('');
  });

  it('cuts to max and trims a hyphen the cut leaves at the end', () => {
    expect(toSlugWords('aaaa bbbb', 5)).toBe('aaaa');
    expect(toSlugWords('aaaa bbbb', 4)).toBe('aaaa');
    expect(toSlugWords('abcdef', 3)).toBe('abc');
  });

  it('agrees with slugify wherever slugify has no fallback', () => {
    for (const title of ['DEMO Filtro de aceite OC 1234', 'Aceite sintético ñandú', 'x'.repeat(200)]) {
      expect(slugify(title)).toBe(toSlugWords(title, 80));
    }
  });
});

describe('uniqueSlug', () => {
  it('returns the base when it is free', async () => {
    expect(await uniqueSlug('base', async () => false)).toBe('base');
  });

  it('appends -2, -3 on collision', async () => {
    const taken = new Set(['base', 'base-2']);
    expect(await uniqueSlug('base', async (candidate) => taken.has(candidate))).toBe('base-3');
  });
});
