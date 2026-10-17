import { describe, expect, it } from 'vitest';

import messages from '../../messages/es-ES.json';
import { dateMessagePattern, icuPlural, normaliseSpaces } from '../support/messages';

// The e2e specs assert copy through these helpers, so they are pinned here
// where a failure is quick and has no browser in it.
describe('tests/support/messages.ts', () => {
  it('icuPlural picks one for 1 and other for the rest, filling #', () => {
    const message = messages.Product.shopCount;
    expect(icuPlural(message, 1)).toMatch(/^1 \S+$/);
    expect(icuPlural(message, 2)).toMatch(/^2 \S+$/);
    expect(icuPlural(message, 1)).not.toBe(icuPlural(message, 2).replace('2', '1'));
  });

  it('icuPlural works on a message written in the test', () => {
    const message = '{count, plural, one {# cosa} other {# cosas}}';
    expect(icuPlural(message, 1)).toBe('1 cosa');
    expect(icuPlural(message, 0)).toBe('0 cosas');
    expect(icuPlural(message, 3)).toBe('3 cosas');
  });

  it('dateMessagePattern matches the shape of an ICU medium es-ES date and nothing else', () => {
    const pattern = dateMessagePattern(messages.Product.priceUpdatedOn);
    const prefix = messages.Product.priceUpdatedOn.split('{')[0];
    expect(pattern.test(`${prefix}17 oct 2026`)).toBe(true);
    expect(pattern.test(`${prefix}1 sept 2026`)).toBe(true);
    expect(pattern.test(`${prefix}hoy`)).toBe(false);
    expect(pattern.test('17 oct 2026')).toBe(false);
  });

  it('normaliseSpaces replaces U+00A0 only', () => {
    expect(normaliseSpaces('1 € a')).toBe('1 € a');
  });
});
