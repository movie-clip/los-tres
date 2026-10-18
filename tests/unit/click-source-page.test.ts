import { describe, expect, it } from 'vitest';

import { sourcePageFromReferer } from '@/server/clicks/source-page';

const HOST = 'shop.test:3000';

describe('sourcePageFromReferer (guardrail 5: a path of ours, never a URL)', () => {
  it('returns the path of a same-origin product page', () => {
    expect(sourcePageFromReferer(`http://${HOST}/producto/x`, HOST)).toBe('/producto/x');
    expect(sourcePageFromReferer(`https://${HOST}/producto/x`, HOST)).toBe('/producto/x');
  });

  it('returns / for the home page', () => {
    expect(sourcePageFromReferer(`http://${HOST}/`, HOST)).toBe('/');
    expect(sourcePageFromReferer(`http://${HOST}`, HOST)).toBe('/');
  });

  it('drops the query string and the fragment', () => {
    const result = sourcePageFromReferer(`http://${HOST}/producto/x?q=secret#frag`, HOST);
    expect(result).toBe('/producto/x');
    expect(result).not.toContain('secret');
    expect(result).not.toContain('frag');
  });

  it('compares the host case-insensitively', () => {
    expect(sourcePageFromReferer('http://SHOP.test:3000/producto/x', 'shop.TEST:3000')).toBe('/producto/x');
  });

  it('never carries userinfo from the referer into the result', () => {
    const result = sourcePageFromReferer(`http://user:pw@${HOST}/producto/x`, HOST);
    expect(result === null || (!result.includes('user') && !result.includes('pw'))).toBe(true);
  });

  it.each([
    ['a different host', 'http://other.test:3000/producto/x', HOST],
    ['a different port', 'http://shop.test:4000/producto/x', HOST],
    ['a missing referer', null, HOST],
    ['a missing host', `http://${HOST}/producto/x`, null],
    ['an empty referer', '', HOST],
    ['an empty host', `http://${HOST}/producto/x`, ''],
    ['text that is not a URL', 'not a url', HOST],
    ['an ftp scheme', `ftp://${HOST}/producto/x`, HOST],
    ['a protocol-relative double slash path', `http://${HOST}//evil`, HOST],
    ['an uppercase path', `http://${HOST}/Producto/X`, HOST],
    ['a percent escape', `http://${HOST}/producto/%41`, HOST],
    ['an @ in the path', `http://${HOST}/producto/a@b`, HOST],
    ['a dot-dot segment', `http://${HOST}/producto/../admin`, HOST],
    ['an encoded dot-dot', `http://${HOST}/producto/%2e%2e/x`, HOST],
    ['a dot in the path', `http://${HOST}/producto/a.b`, HOST],
    ['a path of 201 characters', `http://${HOST}/${'a'.repeat(200)}`, HOST],
  ])('gives null for %s', (_name, referer, host) => {
    expect(sourcePageFromReferer(referer, host)).toBeNull();
  });

  it('accepts a path of exactly 200 characters', () => {
    const path = `/${'a'.repeat(199)}`;
    expect(path).toHaveLength(200);
    expect(sourcePageFromReferer(`http://${HOST}${path}`, HOST)).toBe(path);
  });
});
