import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectedRowsShown,
  isLocalFlagOn,
  isLoopbackOrigin,
  LOCAL_FLAG_REFUSAL,
  LOCAL_FLAG_REFUSAL_EXIT,
  localFlagRefusal,
} from '@/config/local-flag';

// The local flag's truth table (S12.2, C-7): ACs 11, 33 (the judgement), 36 and
// 37 over the pure functions. No database. Both variables are given explicitly,
// so no case depends on the developer's .env.

afterEach(() => {
  vi.unstubAllEnvs();
});

const LOOPBACK = 'http://127.0.0.1:3010';
const PUBLIC_HTTPS = 'https://example.test';

describe('isLocalFlagOn (AC 11)', () => {
  it('is off when LOCAL_COLLECTED_DATA is unset', () => {
    expect(isLocalFlagOn({})).toBe(false);
    expect(isLocalFlagOn({ LOCAL_COLLECTED_DATA: undefined })).toBe(false);
  });

  it.each(['true', 'TRUE', 'True', ' true ', '\ttrue\n'])('is on for %j', (value) => {
    expect(isLocalFlagOn({ LOCAL_COLLECTED_DATA: value })).toBe(true);
  });

  it.each(['false', 'FALSE', 'yes', '1', 'on', 'truee', 'tru', 't rue', '', '   '])('is off for %j', (value) => {
    expect(isLocalFlagOn({ LOCAL_COLLECTED_DATA: value })).toBe(false);
  });

  it('reads process.env on every call by default, not at module load', () => {
    vi.stubEnv('LOCAL_COLLECTED_DATA', 'true');
    expect(isLocalFlagOn()).toBe(true);
    vi.stubEnv('LOCAL_COLLECTED_DATA', 'false');
    expect(isLocalFlagOn()).toBe(false);
  });
});

describe('isLoopbackOrigin (OD-2, D-2)', () => {
  it.each([
    'http://localhost',
    'http://localhost:3010',
    'https://localhost',
    'HTTP://LOCALHOST:3000',
    'http://127.0.0.1',
    'http://127.0.0.1:3010',
    ' http://127.0.0.1:3010 ',
    'https://127.0.0.1',
    'http://127.255.255.254',
    'http://127.1',
    'http://0x7f.0.0.1',
    'http://[::1]',
    'http://[::1]:3010',
    'https://[0:0:0:0:0:0:0:1]',
    'http://127.0.0.1:3010/some/path?q=1',
  ])('accepts %j', (value) => {
    expect(isLoopbackOrigin(value)).toBe(true);
  });

  it.each([
    undefined,
    '',
    '   ',
    'not a url',
    '127.0.0.1',
    'localhost:3010',
    'ftp://127.0.0.1',
    'file:///tmp',
    'ws://localhost',
    'https://example.test',
    'http://example.test',
    'http://192.168.1.10',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://0.0.0.0',
    'http://128.0.0.1',
    'http://localhost.',
    'http://app.localhost',
    'http://localhost.example.test',
    'http://127.0.0.1.example.test',
    'http://[::ffff:127.0.0.1]',
    'http://[::2]',
    'http://127.0.0.256',
  ])('refuses %j', (value) => {
    expect(isLoopbackOrigin(value)).toBe(false);
  });
});

describe('collectedRowsShown (ACs 13, 37: the backstop)', () => {
  it('is true only for the flag on beside a loopback SITE_URL', () => {
    expect(collectedRowsShown({ LOCAL_COLLECTED_DATA: 'true', SITE_URL: LOOPBACK })).toBe(true);
    expect(collectedRowsShown({ LOCAL_COLLECTED_DATA: 'true', SITE_URL: 'http://localhost:3000' })).toBe(true);
  });

  it.each([
    ['flag on, public https', { LOCAL_COLLECTED_DATA: 'true', SITE_URL: PUBLIC_HTTPS }],
    ['flag on, public http', { LOCAL_COLLECTED_DATA: 'true', SITE_URL: 'http://example.test' }],
    ['flag on, private network', { LOCAL_COLLECTED_DATA: 'true', SITE_URL: 'http://192.168.1.10' }],
    ['flag on, unparsable', { LOCAL_COLLECTED_DATA: 'true', SITE_URL: 'not a url' }],
    ['flag on, SITE_URL unset', { LOCAL_COLLECTED_DATA: 'true' }],
    ['flag off, loopback', { LOCAL_COLLECTED_DATA: 'false', SITE_URL: LOOPBACK }],
    ['flag unset, loopback', { SITE_URL: LOOPBACK }],
    ['nothing set', {}],
  ])('is false for %s', (_label, env) => {
    expect(collectedRowsShown(env)).toBe(false);
  });

  it('reads process.env on every call by default', () => {
    vi.stubEnv('LOCAL_COLLECTED_DATA', 'true');
    vi.stubEnv('SITE_URL', LOOPBACK);
    expect(collectedRowsShown()).toBe(true);
    vi.stubEnv('SITE_URL', PUBLIC_HTTPS);
    expect(collectedRowsShown()).toBe(false);
  });
});

describe('localFlagRefusal (ACs 33 to 36)', () => {
  it.each([
    ['public https', PUBLIC_HTTPS],
    ['public http', 'http://example.test'],
    ['private network', 'http://192.168.1.10'],
    ['unparsable', 'not a url'],
    ['blank', ''],
    ['unset', undefined],
  ])('refuses with the one line for the flag on and a %s SITE_URL', (_label, siteUrl) => {
    expect(localFlagRefusal({ LOCAL_COLLECTED_DATA: 'true', SITE_URL: siteUrl })).toBe(LOCAL_FLAG_REFUSAL);
  });

  it.each([
    ['flag on, loopback', { LOCAL_COLLECTED_DATA: 'true', SITE_URL: LOOPBACK }],
    ['flag off, public https', { LOCAL_COLLECTED_DATA: 'false', SITE_URL: PUBLIC_HTTPS }],
    ['flag unset, public https', { SITE_URL: PUBLIC_HTTPS }],
    ['flag unset, SITE_URL unset', {}],
    ['flag "1", public https', { LOCAL_COLLECTED_DATA: '1', SITE_URL: PUBLIC_HTTPS }],
  ])('does not refuse for %s', (_label, env) => {
    expect(localFlagRefusal(env)).toBeNull();
  });

  it('names the two settings and no value, and exits 78', () => {
    expect(LOCAL_FLAG_REFUSAL).toBe(
      'start refused: LOCAL_COLLECTED_DATA is on and SITE_URL is not a loopback origin',
    );
    expect(LOCAL_FLAG_REFUSAL).not.toMatch(/example|https?:|true/);
    expect(LOCAL_FLAG_REFUSAL_EXIT).toBe(78);
  });
});
