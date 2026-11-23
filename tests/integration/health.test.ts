import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/(public)/api/health/route';
import { closeDb } from '@/db/client';

import { unusedPort } from '../support/net';

const PASSWORD = 'pw-sentinel-9f3';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await closeDb();
});

describe('GET /api/health (C-6)', () => {
  it('answers 200 with the exact ok body against the real test database', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ status: 'ok', db: 'up' });
  });

  // The 2 s bound on a database that hangs is proved with fake timers in
  // tests/unit/health-timeout.test.ts; a closed port fails at once.
  it('answers 503 with the exact degraded body when the database is unreachable', async () => {
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:${PASSWORD}@127.0.0.1:${port}/nothing`);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: 'degraded', db: 'down' });
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toContain(PASSWORD);

    // The log line carries an error code only: no host, URL or password.
    const output = JSON.stringify(logged.mock.calls);
    expect(output).not.toContain('127.0.0.1');
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain('postgres://');
  });
});
