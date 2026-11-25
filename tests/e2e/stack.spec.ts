import { expect, test } from '@playwright/test';

test.describe('Compose stack', () => {
  test('GET /api/health answers 200 with the exact C-6 body through Compose', async ({
    request,
  }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headers()['set-cookie']).toBeUndefined();
    expect(await response.json()).toEqual({ status: 'ok', db: 'up' });
  });
});

// #339 (0006 rule 9): a built-server check (B2). The `Referrer-Policy: same-origin` header of the two pages whose
// address can hold a search term comes from next.config.ts and is applied by the running server; the config
// itself is read in unit/admin-config.test.ts. A page outside the two (the home page) does not send it.
test.describe('Referrer-Policy (#339)', () => {
  test('/buscar and /mi-coche answer Referrer-Policy: same-origin, and the home page does not', async ({ request }) => {
    for (const path of ['/buscar?q=filtro', '/mi-coche']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['referrer-policy'], path).toBe('same-origin');
    }
    const home = await request.get('/');
    expect(home.status()).toBe(200);
    expect(home.headers()['referrer-policy']).not.toBe('same-origin');
  });
});
