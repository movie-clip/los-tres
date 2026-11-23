import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/(public)/api/health/route';

// The 2 s bound on the health check (C-6), proved with fake timers instead of a clock
// (0006, time in tests, rule 1): the database call never settles, the fake clock moves
// 1999 ms and the route is still waiting, one more millisecond and it answers 503. The
// integration test (tests/integration/health.test.ts) reaches a closed port, which fails
// in milliseconds and never gets near this bound.

const hoisted = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/db/client', () => ({ getDb: () => ({ execute: hoisted.execute }) }));

const CHECK_TIMEOUT_MS = 2000;

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  hoisted.execute.mockReset();
});

describe('GET /api/health, the 2 s bound (C-6)', () => {
  it('keeps waiting for a database that never answers until 2000 ms, then answers 503 with the timeout code', async () => {
    hoisted.execute.mockReturnValue(new Promise(() => {}));
    let settled = false;
    const pending = GET().then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1);
    expect(settled, 'the route gave up before the bound').toBe(false);
    expect(logged).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled, 'the route was still waiting at the bound').toBe(true);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ status: 'degraded', db: 'down' });
    expect(logged.mock.calls).toEqual([['health: database check failed (TIMEOUT)']]);
  });

  it('answers 200 as soon as the database answers and leaves no timer behind', async () => {
    hoisted.execute.mockResolvedValue({ rows: [] });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', db: 'up' });
    expect(logged).not.toHaveBeenCalled();
    expect(vi.getTimerCount(), 'the 2 s timer was not cleared').toBe(0);
  });
});
