import { vi } from 'vitest';

/**
 * Replaces global `fetch` with a stub that throws, so a test can prove the code
 * under test made no request (and cannot reach a live network by accident).
 * Pair with `vi.unstubAllGlobals()` in `afterEach`.
 */
export function stubNetworkOff(): ReturnType<typeof vi.fn> {
  const stub = vi.fn(async () => {
    throw new Error('network is off in tests');
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}
