import { afterEach, describe, expect, it, vi } from 'vitest';

import { readOptionalEnv } from '@/config/env';
import { isDemoSeedEnabled } from '@/config/seed';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isDemoSeedEnabled (C-17, TD-20)', () => {
  it('is off when SEED_DEMO_DATA is unset', () => {
    vi.stubEnv('SEED_DEMO_DATA', undefined);
    expect(isDemoSeedEnabled()).toBe(false);
  });

  it.each(['true', 'TRUE', 'True', ' true ', '\ttrue\n'])('is on for %j', (value) => {
    vi.stubEnv('SEED_DEMO_DATA', value);
    expect(isDemoSeedEnabled()).toBe(true);
  });

  it.each(['false', 'FALSE', 'yes', '1', 'on', 'truee', 'tru', '', '   '])(
    'is off for %j',
    (value) => {
      vi.stubEnv('SEED_DEMO_DATA', value);
      expect(isDemoSeedEnabled()).toBe(false);
    },
  );

  it('reads the environment on every call, not at module load', () => {
    vi.stubEnv('SEED_DEMO_DATA', 'true');
    expect(isDemoSeedEnabled()).toBe(true);
    vi.stubEnv('SEED_DEMO_DATA', 'false');
    expect(isDemoSeedEnabled()).toBe(false);
  });
});

describe('readOptionalEnv', () => {
  it('returns the trimmed value, or undefined when unset or blank', () => {
    vi.stubEnv('LT_OPTIONAL_PROBE', '  value ');
    expect(readOptionalEnv('LT_OPTIONAL_PROBE')).toBe('value');
    vi.stubEnv('LT_OPTIONAL_PROBE', '   ');
    expect(readOptionalEnv('LT_OPTIONAL_PROBE')).toBeUndefined();
    vi.stubEnv('LT_OPTIONAL_PROBE', undefined);
    expect(readOptionalEnv('LT_OPTIONAL_PROBE')).toBeUndefined();
  });
});
