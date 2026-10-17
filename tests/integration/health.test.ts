import { createServer } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/(public)/api/health/route';
import { closeDb } from '@/db/client';

const PASSWORD = 'pw-sentinel-9f3';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await closeDb();
});

async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe('GET /api/health (C-6)', () => {
  it('answers 200 with the exact ok body against the real test database', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('answers 503 with the exact degraded body within 5 s when the database is unreachable', async () => {
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:${PASSWORD}@127.0.0.1:${port}/nothing`);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const started = Date.now();
    const response = await GET();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(5000);
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
