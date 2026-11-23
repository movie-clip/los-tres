import { vi } from 'vitest';

// The local flag for the S12.2 tests (decision 0017). The visibility scope reads
// LOCAL_COLLECTED_DATA and SITE_URL from the environment on every call, so a test sets
// BOTH explicitly with `vi.stubEnv` and never depends on the developer's .env. The caller
// restores with `vi.unstubAllEnvs()` in `afterEach`.

export const LOOPBACK_ORIGIN = 'http://127.0.0.1:3010';

/**
 * How the flag and the origin are set:
 *   off          flag unset, loopback SITE_URL: the default a deploy has
 *   on           flag on, loopback SITE_URL: the one state in which marked rows are shown
 *   on-https     flag on, a public https SITE_URL: the backstop, shown as off
 *   on-http      flag on, a public http SITE_URL
 *   on-private   flag on, a private-network SITE_URL
 *   on-unparsable flag on, a SITE_URL that is not a URL
 *   on-no-origin flag on, SITE_URL unset
 */
export type LocalFlagMode = 'off' | 'on' | 'on-https' | 'on-http' | 'on-private' | 'on-unparsable' | 'on-no-origin';

/** The modes in which marked rows stay hidden although the flag is on (the backstop, AC 37). */
export const BACKSTOP_MODES: LocalFlagMode[] = ['on-https', 'on-http', 'on-private', 'on-unparsable', 'on-no-origin'];

const SITE_URL_OF: Record<LocalFlagMode, string | undefined> = {
  off: LOOPBACK_ORIGIN,
  on: LOOPBACK_ORIGIN,
  'on-https': 'https://tienda-publica.example',
  'on-http': 'http://tienda-publica.example',
  'on-private': 'http://192.168.1.10:3010',
  'on-unparsable': 'no es una url',
  'on-no-origin': undefined,
};

export function stubLocalFlag(mode: LocalFlagMode): void {
  vi.stubEnv('LOCAL_COLLECTED_DATA', mode === 'off' ? undefined : 'true');
  vi.stubEnv('SITE_URL', SITE_URL_OF[mode]);
}
