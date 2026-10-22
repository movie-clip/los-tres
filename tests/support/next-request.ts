import { vi } from 'vitest';

// A stand-in for the request Next.js gives a server component or action, for
// the admin integration tests. `vi.mock('next/headers', ...)` in a test file
// returns `nextHeadersModule`, so `headers()` yields the headers the test set
// and `cookies()` yields a store that records every write instead of sending it.
// The sign-in and sign-out actions and the guard read the request only through
// those two functions, so this is the whole request they can see.

export type CookieWrite = { name: string; value: string; options: Record<string, unknown> };

export const nextRequest = {
  headers: new Headers(),
  cookieWrites: [] as CookieWrite[],
};

/** Starts a fresh request: the given headers, nothing written. */
export function startRequest(headers: Record<string, string> = {}): void {
  nextRequest.headers = new Headers(headers);
  nextRequest.cookieWrites = [];
}

/** Sets a request with the session cookie, and an Origin when given (use null for none). */
export function startAdminRequest(o: { cookie?: string; origin?: string | null } = {}): void {
  const headers: Record<string, string> = {};
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin) headers.origin = o.origin;
  startRequest(headers);
}

export const nextHeadersModule = {
  headers: async () => nextRequest.headers,
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      nextRequest.cookieWrites.push({ name, value, options });
    },
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    delete: vi.fn(),
  }),
};

/** The `{ kind, to }` of a thrown Next redirect, or null when `error` is not one. */
export function redirectTarget(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== 'string') return null;
  const [marker, , to] = digest.split(';');
  return marker === 'NEXT_REDIRECT' ? to : null;
}

/** Runs `fn` and returns the redirect target it throws; fails if it does not redirect. */
export async function redirectOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    const to = redirectTarget(error);
    if (to !== null) return to;
    throw error;
  }
  throw new Error('expected a redirect');
}
