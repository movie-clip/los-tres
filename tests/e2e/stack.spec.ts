import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { umamiBaseUrl } from '../support/env';

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

  test('Umami answers 200 on its heartbeat', async ({ request }) => {
    const response = await request.get(`${umamiBaseUrl()}/api/heartbeat`);
    expect(response.status()).toBe(200);
  });

  test('Umami answers 200 at / after following its redirect to the login page', async ({
    request,
  }) => {
    // Umami redirects / with a 307; the request client follows redirects.
    const response = await request.get(`${umamiBaseUrl()}/`);
    expect(response.status()).toBe(200);
  });

  test('an unknown path returns 404 with the Spanish not-found page and no cookie', async ({
    page,
    context,
  }) => {
    const response = await page.goto('/no-existe');
    expect(response?.status()).toBe(404);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { name: messages.NotFound.heading })).toBeVisible();
    expect(await context.cookies()).toEqual([]);
  });
});
