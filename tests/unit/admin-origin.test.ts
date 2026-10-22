import { describe, expect, it } from 'vitest';

import { isSameSiteOrigin } from '@/server/auth/origin';

// D-16, AC 16: sign-in and sign-out accept only the site's own origin. A missing
// header is refused too, because Next lets a server action through without one.

const SITE = 'http://127.0.0.1:3000';

describe('isSameSiteOrigin (D-16)', () => {
  it('accepts the site origin, with or without a trailing slash or path', () => {
    expect(isSameSiteOrigin('http://127.0.0.1:3000', SITE)).toBe(true);
    expect(isSameSiteOrigin('http://127.0.0.1:3000/', SITE)).toBe(true);
    expect(isSameSiteOrigin('http://127.0.0.1:3000/admin/acceso', SITE)).toBe(true);
  });

  it('compares origins, so a SITE_URL with a path or slash still matches', () => {
    expect(isSameSiteOrigin('http://127.0.0.1:3000', `${SITE}/`)).toBe(true);
    expect(isSameSiteOrigin('https://example.test', 'https://example.test/anything')).toBe(true);
  });

  it('treats the default port as the same origin', () => {
    expect(isSameSiteOrigin('https://example.test:443', 'https://example.test')).toBe(true);
    expect(isSameSiteOrigin('http://example.test', 'http://example.test:80')).toBe(true);
  });

  it.each([
    ['missing', null],
    ['undefined', undefined],
    ['empty', ''],
    ['the opaque origin', 'null'],
    ['not a URL', 'not a url'],
    ['another site', 'https://evil.example'],
    ['another port', 'http://127.0.0.1:3001'],
    ['another scheme', 'https://127.0.0.1:3000'],
    ['another host name for the same machine', 'http://localhost:3000'],
    ['a subdomain', 'http://app.127.0.0.1:3000'],
    ['a host that begins with the site host', 'http://127.0.0.1:3000.evil.example'],
    ['the site as a user name', 'http://127.0.0.1:3000@evil.example'],
    ['another origin with the site in its path', 'https://evil.example/http://127.0.0.1:3000'],
  ])('refuses %s', (_label, origin) => {
    expect(isSameSiteOrigin(origin, SITE)).toBe(false);
  });
});
