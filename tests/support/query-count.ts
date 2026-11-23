import { vi } from 'vitest';

import { getDb } from '@/db/client';

export type CapturedQuery = { text: string; params: unknown[] };

type Spied = {
  query: (...args: unknown[]) => unknown;
  connect: (...args: unknown[]) => unknown;
};

function captured(args: unknown[]): CapturedQuery {
  const [config, values] = args;
  if (typeof config === 'string') {
    return { text: config, params: Array.isArray(values) ? values : [] };
  }
  const { text, values: own } = (config ?? {}) as { text?: unknown; values?: unknown };
  const bound = Array.isArray(values) ? values : Array.isArray(own) ? own : [];
  return { text: typeof text === 'string' ? text : '', params: bound };
}

/**
 * Runs `call` and returns what it returned with every round trip it made to the
 * database (no-clock-in-gate S-1, 02-design § Deterministic replacements). It
 * counts what the machine's speed cannot change: Drizzle sends each read through
 * `getDb().$client.query`, so a pass-through spy on that pool sees them all, in
 * text and bound parameters, and never changes an answer.
 *
 * A read that checks a client out by itself (a transaction, `pool.connect`)
 * would escape that spy, and the Pool's own `query` checks one out per query, so
 * the helper also spies `connect` and throws when it ran more times than
 * `query`: such a read cannot be counted, and a count that silently misses it
 * would be a ceiling that can never fail. The error never carries query text.
 */
export async function captureQueries<T>(
  call: () => Promise<T>,
): Promise<{ result: T; queries: CapturedQuery[] }> {
  const pool = getDb().$client as unknown as Spied;
  const querySpy = vi.spyOn(pool, 'query');
  const connectSpy = vi.spyOn(pool, 'connect');
  try {
    const result = await call();
    const queries = querySpy.mock.calls.map((args) => captured(args));
    if (connectSpy.mock.calls.length > queries.length) {
      throw new Error(
        `captureQueries: ${connectSpy.mock.calls.length} client checkouts for ${queries.length} queries; a read took a client by itself and cannot be counted`,
      );
    }
    return { result, queries };
  } finally {
    querySpy.mockRestore();
    connectSpy.mockRestore();
  }
}
