import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED, DEMO_SHOP_HOSTS } from '../fixtures/demo';

// US-5.4 ACs 31 and 32 (guardrail 5, D-3): the search term is never logged and never stored.
// Proved against the running Compose stack with a marker nobody else types:
//   - the app container's output after a successful search and a no-result search,
//   - the output of a one-off container whose database is unreachable, and its error page,
//   - a full data-only pg_dump after a click-through from the results to a shop.
// Every assertion is "absent" or "contains"; the failing search logs its fixed line several times
// per request (proxy, metadata, page), so no count is pinned.
//
// If the production server ever prints request URLs, the first test fails and the run goes to the
// human (decision D-A9); the test is not to be weakened.

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const marker = `zq${[...randomBytes(10)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('')}`;
// The demo part number "OC 1234" with a dot after every character: it finds the demo product
// through the part-number route, and this exact text occurs nowhere else.
const dotted = [...DEMO_SHARED.partNumber.replace(/[^A-Za-z0-9]/g, '')].join('.');
const secrets = [marker, dotted];

/** The raw text, and the URL-encoded spellings of it, that must appear nowhere. */
const spellings = (term: string): string[] => [
  term,
  encodeURIComponent(term),
  term.replace(/\./g, '%2E'),
  new URLSearchParams({ q: term }).toString(),
];
const forbidden = secrets.flatMap(spellings);

function docker(args: string[], options: { input?: string; timeout?: number } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 60_000,
    maxBuffer: 256 * 1024 * 1024,
    input: options.input,
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const appLogs = () => docker(['compose', 'logs', 'app', '--no-log-prefix']).out;

function expectNoSecret(text: string, where: string): void {
  for (const spelling of forbidden) {
    expect(text.includes(spelling), `${where} holds ${spelling === marker ? 'the marker' : 'a spelling of a search term'}`).toBe(
      false,
    );
  }
}

test.describe('the search term is never logged or stored (AC 31, 32)', () => {
  let logBefore = '';

  test('the success and no-result searches and a click-through leave no trace in the app container output', async ({
    page,
    context,
    request,
  }) => {
    logBefore = appLogs();
    expect(logBefore, 'docker compose logs answered').toContain('Ready');

    // No result.
    const none = await request.get(`/buscar?q=${marker}`);
    expect(none.status()).toBe(200);
    // Success, through the part-number route (found only because normalisation drops the dots).
    const found = await request.get(`/buscar?q=${dotted}`);
    expect(found.status()).toBe(200);
    expect(await found.text()).toContain(DEMO_SHARED.title);

    // A browser path as well: results, a card, the product page, the shop link.
    await page.goto(`/buscar?q=${dotted}`);
    await expect(page.getByTestId('category-card')).toHaveCount(1);
    await page.getByTestId('card-title').click();
    await expect(page).toHaveURL(new RegExp(`/producto/${DEMO_SHARED.slug}$`));
    const shop = page.waitForRequest((req) => DEMO_SHOP_HOSTS.some((host) => new URL(req.url()).hostname === host));
    await page.getByTestId('offer-go').first().click();
    await shop;
    expect(await context.cookies()).toEqual([]);

    // Let the container flush before reading.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = appLogs();
    expectNoSecret(after, 'the app container output');

    // D-A9: the production server must print no request URL at all. The slice is the output written
    // since the first read; if the output was rotated, the whole of it is read.
    const added = after.startsWith(logBefore) ? after.slice(logBefore.length) : after;
    expect(added, 'the production server prints a request line').not.toMatch(/\b(GET|POST|HEAD|OPTIONS)\s+\//);
    expect(added, 'the production server prints a request path').not.toMatch(/\/(buscar|producto|go)\b/);
  });

  test('a failing search shows the generic error page and logs only a fixed code', async ({ browser }) => {
    const name = `los-tres-e2e-search-fail-${marker}`;
    const run = docker(
      [
        'compose', 'run', '-d', '--no-deps', '--name', name, '-p', '127.0.0.1::3000',
        '--entrypoint', 'node',
        '-e', 'DATABASE_URL=postgres://x:x@127.0.0.1:1/x',
        'app', 'server.js',
      ],
      { timeout: 120_000 },
    );
    try {
      expect(run.status, run.out).toBe(0);

      const mapping = docker(['port', name, '3000/tcp']).out.trim().split(/\r?\n/)[0] ?? '';
      const port = /:(\d+)$/.exec(mapping)?.[1];
      expect(port, `docker port said: ${mapping}`).toBeDefined();
      const origin = `http://127.0.0.1:${port}`;

      // Wait for the server: robots.txt needs no database.
      let ready = false;
      for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
        ready = await fetch(`${origin}/robots.txt`).then((r) => r.status === 200, () => false);
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(ready, 'the failing server started').toBe(true);

      // HTTP level: a 500 (the body is Next's empty error shell until the page hydrates).
      for (const term of secrets) {
        const response = await fetch(`${origin}/buscar?q=${encodeURIComponent(term)}`);
        expect(response.status, term).toBe(500);
        expect(response.headers.get('set-cookie')).toBeNull();
        const markup = (await response.text()).replace(/<script\b[\s\S]*?<\/script>/gi, '');
        expectNoSecret(markup, 'the error response outside script');
      }

      // Browser level: the site's generic error page, not the framework's English default.
      const context = await browser.newContext();
      const page = await context.newPage();
      const response = await page.goto(`${origin}/buscar?q=${marker}`);
      expect(response?.status()).toBe(500);
      const error = page.getByTestId('public-error');
      await expect(error).toBeVisible();
      await expect(error).toContainText(messages.Error.heading);
      await expect(error).toContainText(messages.Error.body);
      expectNoSecret((await page.locator('body').innerText()).trim(), 'the visible error page');
      expect(await context.cookies()).toEqual([]);
      await context.close();

      const logs = docker(['logs', name]).out;
      expect(logs, 'the failure is logged as a code').toContain('search: failed (');
      expectNoSecret(logs, 'the failing container output');
      expect(logs, 'the connection string reached the log').not.toContain('postgres://');
      expect(logs).not.toMatch(/\b(GET|POST|HEAD)\s+\//);
    } finally {
      docker(['rm', '-f', name]);
    }
  });

  test('no database row holds the term after the searches and the click-through (AC 32)', async () => {
    const dump = docker(
      ['compose', 'exec', '-T', 'db', 'sh', '-c', 'pg_dump --data-only -U "$POSTGRES_USER" "$POSTGRES_DB"'],
      { timeout: 120_000 },
    );
    expect(dump.status, dump.out.slice(0, 300)).toBe(0);
    // The dump is real: it holds the demo catalogue, so an empty answer cannot pass this test.
    expect(dump.out).toContain(DEMO_SHARED.title);
    expectNoSecret(dump.out, 'the database dump');
  });
});
