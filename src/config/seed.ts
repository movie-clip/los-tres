import 'server-only';

import { readOptionalEnv } from './env';

/**
 * Whether the demo seed runs on start (SEED_DEMO_DATA). True only for the
 * value `true`, trimmed and case-insensitive; unset or anything else is off.
 * Read on every call, never at module load.
 */
export function isDemoSeedEnabled(): boolean {
  return readOptionalEnv('SEED_DEMO_DATA')?.toLowerCase() === 'true';
}
