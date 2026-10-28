import { spawnSync } from 'node:child_process';

import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { cssColour, snapshotOf, whilePressed } from '../support/page-checks';

// US-2.3 against the Compose stack, read-only (D-9): no spec here changes an
// approval in the shared development database, because fullyParallel specs and
// the next run's global setup read it. The writes are proved in
// tests/integration/admin-sources.test.ts on the test database. What this spec
// proves in a browser: the page is refused to anonymous visitors, the signed-in
// page renders its loaded state and the confirm panel, a failed write leaves
// the page as it was, and no feed URL reaches the HTML.
//
// This spec owns its own admin account. admin.spec.ts says no other spec may
// use its account (creating an admin again ends that admin's sessions), so this
// one is separate and never signs the first one out.
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const EMAIL = 'e2e-sources-admin@example.test';
const PASSWORD = 'e2e-sources-password-1';
const UNAVAILABLE_HINT =
  'admin e2e: the stack answered "unavailable". Set AUTH_SECRET (32+ characters) and SITE_URL=http://127.0.0.1:<APP_PORT> in .env, then run: docker compose up -d';

const copy = messages.Admin.Sources;
const SHOP_NAMES = ['Tienda Demo Uno', 'Tienda Demo Dos'];
/** A feed id no row has: below the integer ceiling, so the action reaches the database and matches nothing. */
const MISSING_ID = '2000000000';

function createAdminWithCommand(): void {
  const result = spawnSync(
    'docker',
    ['compose', 'run', '--rm', '-T', '--no-deps', 'app', 'create-admin'],
    { input: `${EMAIL}\n${PASSWORD}\n`, encoding: 'utf8', timeout: 80_000 },
  );
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`admin sources e2e: create-admin exited ${result.status ?? 'none'}. Is the stack up with the new image? Run: npm run stack:up\n${out.trim()}`);
  }
  expect(out).toMatch(/create-admin: (created|updated, sessions ended)/);
}

test.beforeAll(() => {
  createAdminWithCommand();
});

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/acceso');
  await page.locator('#admin-email').fill(EMAIL);
  await page.locator('#admin-password').fill(PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('admin-identity')).toBeVisible({ timeout: 20_000 }).catch(async (error) => {
    if (await page.getByText(messages.Admin.SignIn.unavailable).count()) throw new Error(UNAVAILABLE_HINT);
    throw error;
  });
}

/** The shop group (its row and its feeds) whose heading is `name`. */
function shopGroup(page: Page, name: string): Locator {
  return page
    .getByTestId('sources-list')
    .locator('li')
    .filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) });
}

test.describe('anonymous visitors', () => {
  test('an anonymous request for the page is sent to sign-in, with no cookie and nothing from the page (guardrail 3)', async ({
    request,
  }) => {
    const raw = await request.get('/admin/tiendas', { maxRedirects: 0 });
    expect(raw.status()).toBeGreaterThanOrEqual(300);
    expect(raw.status()).toBeLessThan(400);
    expect(raw.headers().location).toContain('/admin/acceso');
    expect(raw.headers()['set-cookie']).toBeUndefined();
    const body = await raw.text();
    for (const shown of [...SHOP_NAMES, copy.intro, copy.listLabel, 'sources-list', 'source-feed-', 'demo-feed:']) {
      expect(body).not.toContain(shown);
    }
  });

  test('the browser lands on sign-in with the session notice, and sees nothing of the page', async ({ page, context }) => {
    await page.goto('/admin/tiendas');
    await expect(page).toHaveURL(/\/admin\/acceso/);
    await expect(page.getByTestId('sources-list')).toHaveCount(0);
    await expect(page.getByTestId('admin-nav')).toHaveCount(0);
    expect(await context.cookies()).toEqual([]);
  });
});

test.describe('the signed-in page', () => {
  test('the nav opens it as the current item, with the heading, the summary and both demo shops approved', async ({ page }) => {
    await signIn(page);
    const link = page.getByTestId('admin-nav').getByRole('link', { name: messages.Admin.Nav.feeds });
    await expect(link).toHaveAttribute('href', '/admin/tiendas');
    await link.click();

    await expect(page).toHaveURL(/\/admin\/tiendas\/?$/);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: copy.heading })).toBeVisible();
    await expect(page.getByTestId('sources-summary')).toBeVisible();
    await expect(page.getByTestId('sources-list')).toHaveAccessibleName(copy.listLabel);

    for (const name of SHOP_NAMES) {
      const group = shopGroup(page, name);
      await expect(group, name).toHaveCount(1);
      await expect(group.getByTestId(/^source-shop-/).getByTestId('source-tag').first(), name).toHaveText(copy.shopApproved);
      const feed = group.getByTestId(/^source-feed-/).first();
      await expect(feed.getByTestId('source-tag'), name).toHaveText(copy.feedApproved);
      await expect(feed, name).toContainText(copy.feedMetaDemo);
      await expect(feed.getByTestId('source-disable'), name).toBeVisible();
      await expect(feed.getByTestId('source-approve'), name).toHaveCount(0);
    }
  });

  test('the page is noindex and no-store, sets no cookie, and carries no feed URL or secret-looking value', async ({ page, request }) => {
    await signIn(page);
    const response = await page.goto('/admin/tiendas');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toMatch(/noindex/);
    expect(response?.headers()['cache-control']).toMatch(/no-store/);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page).toHaveTitle(new RegExp(copy.heading));

    // The signed-in page, as the server sent it: the document and what the page's own
    // markup loads. A feed URL may embed a network API key (guardrail 5).
    const html = await response?.text();
    expect(html).toBeTruthy();
    for (const url of ['demo-feed:', 'apikey', 'api_key', 'token=']) {
      expect(html, url).not.toContain(url);
    }
    expect(await page.content()).not.toContain('demo-feed:');
    // Nothing else is needed from the network: an anonymous client gets nothing of it.
    expect((await request.get('/admin/tiendas', { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(300);
  });

  test('Desactivar feed opens the confirm panel on Cancelar; Escape closes it and returns focus; nothing was written', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/tiendas');
    const posts: Request[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req);
    });

    const feed = shopGroup(page, SHOP_NAMES[0]).getByTestId(/^source-feed-/).first();
    const disable = feed.getByTestId('source-disable');
    await disable.click();

    const panel = feed.getByTestId('source-confirm');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/Desactivar el feed \d+ de Tienda Demo Uno/);
    await expect(panel).toContainText(copy.confirmFeedBody);
    await expect(feed.getByTestId('source-cancel')).toBeFocused();
    await expect(feed.getByTestId('source-confirm-yes')).toHaveText(copy.confirmFeedYes);

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(feed.getByTestId('source-disable')).toBeFocused();

    // Opened again, Cancelar closes it as well.
    await feed.getByTestId('source-disable').click();
    await feed.getByTestId('source-cancel').click();
    await expect(panel).toHaveCount(0);

    await expect(feed.getByTestId('source-tag')).toHaveText(copy.feedApproved);
    expect(posts).toEqual([]);
  });

  test('Desactivar tienda opens the shop panel, which says each feed keeps its own state', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/tiendas');
    const group = shopGroup(page, SHOP_NAMES[1]);
    const shopRow = group.getByTestId(/^source-shop-/).first();
    await shopRow.getByTestId('source-disable').click();
    const panel = shopRow.getByTestId('source-confirm');
    await expect(panel).toContainText(`¿Desactivar la tienda ${SHOP_NAMES[1]}?`);
    await expect(panel).toContainText(copy.confirmShopBody);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(shopRow.getByTestId('source-tag')).toHaveText(copy.shopApproved);
  });

  test('a write the server cannot apply shows the error block and leaves the tag as it was (unknown id, nothing written)', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/tiendas');
    const feed = shopGroup(page, SHOP_NAMES[0]).getByTestId(/^source-feed-/).first();
    await feed.getByTestId('source-disable').click();
    await expect(feed.getByTestId('source-confirm')).toBeVisible();
    // The id is rewritten to a row that does not exist, so the real action answers `failed` and the
    // update matches nothing (D-9): the failed state is reached without changing any approval.
    await feed.getByTestId('source-confirm').locator('xpath=ancestor::form//input[@name="id"]').evaluate((input, id) => {
      (input as HTMLInputElement).value = id;
    }, MISSING_ID);
    await feed.getByTestId('source-confirm-yes').click();

    const block = feed.getByTestId('admin-error');
    await expect(block).toBeVisible();
    await expect(block).toContainText(copy.errorTitle);
    await expect(block).toContainText(copy.errorFeedBody);
    await expect(feed.getByTestId('source-done')).toHaveCount(0);
    await expect(feed.getByTestId('source-tag')).toHaveText(copy.feedApproved);

    await page.goto('/admin/tiendas');
    await expect(shopGroup(page, SHOP_NAMES[0]).getByTestId(/^source-feed-/).first().getByTestId('source-tag')).toHaveText(copy.feedApproved);
  });

  test('the action replayed without the session cookie is redirected to sign-in; with it, the same request is a failed state, so the replay is a valid one', async ({
    page,
    playwright,
    baseURL,
  }) => {
    await signIn(page);
    await page.goto('/admin/tiendas');
    // Capture the browser's own action request and stop it: it never reaches the server.
    let captured: { headers: Record<string, string>; body: string } | null = null;
    await page.route('**/admin/tiendas', async (route) => {
      const req = route.request();
      if (req.method() === 'POST' && req.headers()['next-action']) {
        captured = { headers: req.headers(), body: req.postData() ?? '' };
        await route.abort();
      } else {
        await route.continue();
      }
    });
    const feed = shopGroup(page, SHOP_NAMES[0]).getByTestId(/^source-feed-/).first();
    await feed.getByTestId('source-disable').click();
    await feed.getByTestId('source-confirm-yes').click();
    await expect.poll(() => captured).not.toBeNull();
    await page.unroute('**/admin/tiendas');

    const grabbed = captured as unknown as { headers: Record<string, string>; body: string };
    // Aim the replay at a row that does not exist: even a broken guard could write nothing.
    const body = grabbed.body.replace(/(name="_1_id"\r\n\r\n)\d+/, `$1${MISSING_ID}`);
    expect(body).toContain(MISSING_ID);
    const { cookie, ...withoutCookie } = grabbed.headers;
    expect(cookie).toContain('admin.session_token');
    delete withoutCookie['content-length'];

    const post = async (headers: Record<string, string>) => {
      const client = await playwright.request.newContext({ baseURL });
      try {
        const response = await client.post('/admin/tiendas', { headers, data: Buffer.from(body), maxRedirects: 0 });
        return { status: response.status(), headers: response.headers(), text: await response.text() };
      } finally {
        await client.dispose();
      }
    };

    // Control: with the session the action runs and answers its failed state for the missing row.
    const control = await post({ ...withoutCookie, cookie });
    expect(control.text).toContain('"status":"failed"');

    const anonymous = await post(withoutCookie);
    expect(anonymous.headers['set-cookie']).toBeUndefined();
    expect(`${anonymous.headers['x-action-redirect'] ?? ''}${anonymous.headers.location ?? ''}`).toContain('/admin/acceso');
    expect(anonymous.text).not.toContain('"status":"failed"');
    expect(anonymous.text).not.toContain('"status":"done"');
  });
});

// S11.7 (03-ux checks 18 and 19): pressed states of the shared admin PendingButton. The colours are
// read from tokens, not literals; each press is held on the button and let go away from it.
test.describe('admin pressed buttons (S11.7)', () => {
  test('a pressed filled button reads light fill and dark text, and does not move', async ({ page }) => {
    await page.goto('/admin/acceso');
    const light = await cssColour(page, 'var(--color-bg)');
    const dark = await cssColour(page, 'var(--color-link)');
    const submit = page.getByTestId('sign-in-submit');
    const before = await snapshotOf(submit);
    expect(before.background).toBe(dark);
    const pressed = await whilePressed(page, submit, () => snapshotOf(submit));
    expect(pressed.background).toBe(light);
    expect(pressed.colour).toBe(dark);
    expect([pressed.width, pressed.height]).toEqual([before.width, before.height]);
  });

  test('a pending filled button does not invert when pressed', async ({ page }) => {
    await page.goto('/admin/acceso');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/admin/acceso', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await held;
      return route.abort();
    });
    await page.locator('#admin-email').fill('nobody@example.test');
    await page.locator('#admin-password').fill('not-a-password');
    const submit = page.getByTestId('sign-in-submit');
    await submit.click();
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    const pending = await snapshotOf(submit);
    const pressed = await whilePressed(page, submit, () => snapshotOf(submit));
    expect(pressed.background).toBe(pending.background);
    expect(pressed.colour).toBe(pending.colour);
    release();
  });

  test('signed in, a pressed outlined button reads dark fill and light text, and does not move', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/tiendas');
    const light = await cssColour(page, 'var(--color-bg)');
    const dark = await cssColour(page, 'var(--color-link)');
    const signOut = page.getByTestId('admin-sign-out');
    const before = await snapshotOf(signOut);
    expect(before.background).not.toBe(dark);
    const pressed = await whilePressed(page, signOut, () => snapshotOf(signOut));
    expect(pressed.background).toBe(dark);
    expect(pressed.colour).toBe(light);
    expect([pressed.width, pressed.height]).toEqual([before.width, before.height]);
    await expect(page.getByTestId('admin-identity')).toBeVisible();
  });

  test('signed in, the confirm button of /admin/tiendas is a filled button that inverts when pressed', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/tiendas');
    const light = await cssColour(page, 'var(--color-bg)');
    const feed = shopGroup(page, SHOP_NAMES[0]).getByTestId(/^source-feed-/).first();
    await feed.getByTestId('source-disable').click();
    const yes = feed.getByTestId('source-confirm-yes');
    await expect(yes).toBeVisible();
    const pressed = await whilePressed(page, yes, () => snapshotOf(yes));
    expect(pressed.background).toBe(light);
    // Let go away from the button: nothing was confirmed.
    await expect(feed.getByTestId('source-confirm')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(feed.getByTestId('source-tag')).toHaveText(copy.feedApproved);
  });
});
