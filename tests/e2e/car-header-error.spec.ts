import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { unusedPort } from '../support/net';

// US-5.7 (T5.7.3) against a one-off server: the car control in the header of the public error page
// (ACs 1 and 5). It starts a container, so it runs in the `containers` Playwright project with the
// other container specs (#361); the rest of the header specs are in car-header.spec.ts.

test.describe('the error page carries the control (AC 1, AC 5)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  // The same one-off container as search-privacy.spec.ts: a server whose database is unreachable,
  // so a search ends on the public error page. The header around it must still draw the control,
  // in the no-car state, and must not raise an error of its own.
  test('a failing page shows the generic error and, in the header, the no-car action', async ({ browser }) => {
    const name = `los-tres-e2e-car-error-${randomBytes(6).toString('hex')}`;
    const docker = (args: string[], timeout = 60_000) => {
      const result = spawnSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
      return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    };
    // #361: the server shares the host's network (`--network host`), so starting and removing it creates
    // and removes no network interface, which would cancel the page loads of a browser waiting on a
    // socket. The image is the Compose app's, run with its own port and a database nobody listens on.
    const image = spawnSync('docker', ['compose', 'config', '--images'], { encoding: 'utf8', timeout: 60_000 })
      .stdout.split(/\s+/)
      .find((entry) => entry !== '' && !entry.startsWith('postgres'));
    expect(image, 'the app image name from compose config').toBeTruthy();
    const siteName = process.env.SITE_NAME?.trim();
    expect(siteName, 'SITE_NAME is set in .env').toBeTruthy();
    const port = await unusedPort();
    const origin = `http://127.0.0.1:${port}`;
    const run = docker(
      [
        'run', '-d', '--name', name, '--network', 'host',
        '--entrypoint', 'node',
        '-e', `PORT=${port}`,
        '-e', 'HOSTNAME=127.0.0.1',
        '-e', `SITE_NAME=${siteName}`,
        '-e', 'DATABASE_URL=postgres://x:x@127.0.0.1:1/x',
        image!, 'server.js',
      ],
      120_000,
    );
    try {
      expect(run.status, run.out).toBe(0);
      let ready = false;
      for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
        ready = await fetch(`${origin}/robots.txt`).then((r) => r.status === 200, () => false);
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(ready, 'the failing server started').toBe(true);

      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(`${origin}/buscar?q=filtro`);
      expect(response?.status()).toBe(500);
      await expect(page.getByTestId('public-error')).toBeVisible();
      await expect(page.getByTestId('car-control')).toBeVisible();
      await expect(page.getByTestId('car-select')).toHaveText(messages.Car.select);
      await expect(page.getByTestId('car-label')).toHaveCount(0);
      await expect(page.getByTestId('car-notice')).toHaveCount(0);
      expect(errors).toEqual([]);
      expect(await context.cookies()).toEqual([]);
      await context.close();
    } finally {
      docker(['rm', '-f', name]);
    }
  });
});
