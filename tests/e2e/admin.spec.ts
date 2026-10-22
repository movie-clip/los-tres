import { spawnSync } from 'node:child_process';

import { expect, test, type Page } from '@playwright/test';
import { createTranslator } from 'use-intl/core';

import messages from '../../messages/es-ES.json';

// US-2.1 against the Compose stack: create an admin with the command, sign in,
// see the Spanish shell, sign out, and prove the cookie, header and refusal
// rules (AC 9, 10, 12, 13, 15, 17, 23, 24, 25, 26, 27). The stack needs
// AUTH_SECRET and SITE_URL in .env and `docker compose up -d`; SITE_URL must be
// the address the browser opens (127.0.0.1, not localhost), or the Origin check
// refuses the sign-in by design (D-16).
//
// Serial: creating the admin again ends that admin's open sessions (D-12), so
// the account is made once, before the tests, and the tests share a worker.
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const EMAIL = 'e2e-admin@example.test';
const PASSWORD = 'e2e-password-1';
const COOKIE = 'admin.session_token';
const UNAVAILABLE_HINT =
  'admin e2e: the stack answered "unavailable". Set AUTH_SECRET (32+ characters) and SITE_URL=http://127.0.0.1:<APP_PORT> in .env, then run: docker compose up -d';

const admin = messages.Admin;
const signInT = createTranslator({ locale: 'es-ES', messages, namespace: 'Admin.SignIn' });

function createAdminWithCommand(): void {
  const result = spawnSync(
    'docker',
    ['compose', 'run', '--rm', '-T', '--no-deps', 'app', 'create-admin'],
    { input: `${EMAIL}\n${PASSWORD}\n`, encoding: 'utf8', timeout: 80_000 },
  );
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`admin e2e: create-admin exited ${result.status ?? 'none'}. Is the stack up with the new image? Run: npm run stack:up\n${out.trim()}`);
  }
  // The command never echoes what it was given (AC 3, AC 28).
  expect(out).not.toContain(EMAIL);
  expect(out).not.toContain(PASSWORD);
  expect(out).toMatch(/create-admin: (created|updated, sessions ended)/);
}

test.beforeAll(() => {
  createAdminWithCommand();
});

async function fill(page: Page, email: string, password: string): Promise<void> {
  await page.locator('#admin-email').fill(email);
  await page.locator('#admin-password').fill(password);
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/acceso');
  await fill(page, EMAIL, PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('admin-identity')).toBeVisible({ timeout: 20_000 }).catch(async (error) => {
    if (await page.getByText(admin.SignIn.unavailable).count()) throw new Error(UNAVAILABLE_HINT);
    throw error;
  });
}

test.describe('anonymous visitors', () => {
  test('an anonymous request for the shell is sent to sign-in, with no cookie and nothing from the admin area (AC 17, D-10)', async ({
    request,
    page,
    context,
  }) => {
    const raw = await request.get('/admin', { maxRedirects: 0 });
    expect(raw.status()).toBeGreaterThanOrEqual(300);
    expect(raw.status()).toBeLessThan(400);
    expect(raw.headers().location).toContain('/admin/acceso');
    expect(raw.headers()['set-cookie']).toBeUndefined();
    // The redirect body may carry the page title (static copy); it carries no
    // shell content, identity or admin data.
    const body = await raw.text();
    for (const shown of [admin.Home.emptyBody, admin.Meta.homeTitle.split('{siteName}')[0], admin.Chrome.signedInAs, admin.Nav.feeds, EMAIL, 'admin-identity', 'admin-nav']) {
      expect(body).not.toContain(shown);
    }

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/acceso/);
    await expect(page.getByTestId('admin-notice')).toHaveText(signInT('signInRequired', { hours: 8 }));
    await expect(page.getByTestId('admin-identity')).toHaveCount(0);
    await expect(page.getByTestId('admin-nav')).toHaveCount(0);
    expect(await context.cookies()).toEqual([]);
  });

  test('the sign-in page is Spanish, labelled, noindex, no-store and sets no cookie (AC 8, 12, 23, 24, 27)', async ({
    page,
    context,
    request,
  }) => {
    const response = await page.goto('/admin/acceso');
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers['set-cookie']).toBeUndefined();
    expect(headers['x-robots-tag']).toMatch(/noindex/);
    expect(headers['cache-control']).toMatch(/no-store/);

    await expect(page.locator('html')).toHaveAttribute('lang', /^es/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('heading', { level: 1, name: admin.SignIn.heading })).toBeVisible();
    await expect(page.getByLabel(admin.SignIn.emailLabel)).toBeVisible();
    await expect(page.getByLabel(admin.SignIn.passwordLabel)).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: admin.SignIn.submit })).toBeVisible();

    // No sign-up, recovery, remember-me, public link, footer or checkbox (AC 1, ux check 6 and 1).
    await expect(page.getByRole('contentinfo')).toHaveCount(0);
    await expect(page.locator('main a')).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/olvid|registr|recuérd|recuerd/i);
    expect(await context.cookies()).toEqual([]);

    const raw = await request.get('/admin/acceso');
    expect(raw.headers()['set-cookie']).toBeUndefined();
  });

  test('a path that looks like sign-up or reset gets the ordinary 404, and no cookie (AC 1)', async ({
    request,
  }) => {
    for (const url of ['/admin/registro', '/admin/registrarse', '/admin/olvide-contrasena', '/admin/restablecer', '/registro', '/api/auth/sign-up/email', '/api/auth/forget-password']) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).toBe(404);
      expect(response.headers()['set-cookie'], url).toBeUndefined();
    }
  });
});

test.describe('a failed sign-in', () => {
  test('a wrong password and an unknown email show the same message and start nothing (AC 10, 12)', async ({
    page,
    context,
  }) => {
    const setCookies: string[] = [];
    page.on('response', (response) => {
      const value = response.headers()['set-cookie'];
      if (value) setCookies.push(value);
    });
    await page.goto('/admin/acceso');

    await fill(page, EMAIL, 'definitely-wrong');
    await page.getByTestId('sign-in-submit').click();
    const block = page.getByTestId('admin-error');
    await expect(block).toBeVisible({ timeout: 20_000 }).catch(async (error) => {
      if (await page.getByText(admin.SignIn.unavailable).count()) throw new Error(UNAVAILABLE_HINT);
      throw error;
    });
    const wrongPasswordText = await block.innerText();
    expect(wrongPasswordText).toContain(admin.SignIn.errorTitle);
    expect(wrongPasswordText).toContain(admin.SignIn.invalidCredentials);
    // The email stays, the password is cleared.
    await expect(page.locator('#admin-email')).toHaveValue(EMAIL);
    await expect(page.locator('#admin-password')).toHaveValue('');

    await fill(page, 'nobody-here@example.test', 'definitely-wrong');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.locator('#admin-email')).toHaveValue('nobody-here@example.test');
    await expect(block).toBeVisible();
    expect(await block.innerText()).toBe(wrongPasswordText);

    expect(await context.cookies()).toEqual([]);
    expect(setCookies).toEqual([]);
    await expect(page).toHaveURL(/\/admin\/acceso/);
  });

  test('empty and malformed input show the field messages and no error block (AC 11)', async ({ page, context }) => {
    await page.goto('/admin/acceso');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.locator('#admin-email-error')).toHaveText(admin.SignIn.emailRequired);
    await expect(page.locator('#admin-password-error')).toHaveText(admin.SignIn.passwordRequired);
    await expect(page.getByTestId('admin-error')).toHaveCount(0);

    await fill(page, 'no-at-sign', 'x');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.locator('#admin-email-error')).toHaveText(admin.SignIn.emailInvalid);
    expect(await context.cookies()).toEqual([]);
  });

  test('a sign-in posted with another Origin, or none, is refused and sets no cookie; the site origin succeeds (AC 16, D-16)', async ({
    playwright,
    request,
    baseURL,
  }) => {
    // The no-JavaScript form post, as another site's page would make it: the
    // action's hidden fields are public in the sign-in page, the Origin is not
    // ours to choose when a browser sends it, so it is set here directly.
    const html = await (await request.get('/admin/acceso')).text();
    const hidden: Record<string, string> = {};
    for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?/g)) {
      hidden[match[1].replace(/&amp;/g, '&')] = (match[2] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    }
    expect(Object.keys(hidden).length).toBeGreaterThan(0);

    // A fresh client per post: a cookie kept from the control would sign the
    // next visitor in and change the answer.
    const post = async (origin: string | null) => {
      const client = await playwright.request.newContext({ baseURL });
      try {
        const response = await client.post('/admin/acceso', {
          headers: origin === null ? {} : { origin },
          multipart: { ...hidden, email: EMAIL, password: PASSWORD },
          maxRedirects: 0,
        });
        return { status: response.status(), headers: response.headers(), text: await response.text() };
      } finally {
        await client.dispose();
      }
    };

    // Control: from the site's own origin the same post signs in. Without this
    // the refusals below would prove nothing.
    const own = await post(new URL(baseURL ?? 'http://127.0.0.1').origin);
    if (own.status === 200 && own.text.includes(admin.SignIn.unavailable)) throw new Error(UNAVAILABLE_HINT);
    expect(own.headers['set-cookie'] ?? '').toContain(COOKIE);

    const own2 = new URL(baseURL ?? 'http://127.0.0.1');
    const refused: (string | null)[] = [
      'http://evil.example',
      'null',
      `${own2.protocol}//${own2.hostname}:1`,
      `${own2.protocol === 'https:' ? 'http:' : 'https:'}//${own2.host}`,
      null,
    ];
    for (const origin of refused) {
      const response = await post(origin);
      expect(response.headers['set-cookie'], String(origin)).toBeUndefined();
      expect(response.headers.location ?? '', String(origin)).not.toMatch(/\/admin\/?$/);
    }
  });
});

test.describe('signing in and out', () => {
  test('lands in the Spanish shell with one HttpOnly, same-site, 8-hour cookie (AC 9, 12, 13, 25, 27)', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/admin\/?$/);

    // The shell: header, identity, nav, heading, sign-out.
    await expect(page.getByTestId('admin-header')).toBeVisible();
    await expect(page.getByTestId('admin-identity')).toContainText(admin.Chrome.signedInAs);
    await expect(page.getByTestId('admin-identity')).toContainText(EMAIL);
    await expect(page.getByRole('heading', { level: 1, name: admin.Home.heading })).toBeVisible();
    await expect(page.getByText(admin.Home.emptyBody)).toBeVisible();
    await expect(page.getByTestId('admin-sign-out')).toHaveText(admin.Chrome.signOut);
    await expect(page.getByRole('contentinfo')).toHaveCount(0);

    // Nothing in the menu leads nowhere: only live link is the shell's own home.
    const nav = page.getByTestId('admin-nav');
    expect(await nav.locator('a').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))).toEqual(['/admin']);
    for (const label of [admin.Nav.feeds, admin.Nav.categories, admin.Nav.products, admin.Nav.review]) {
      await expect(nav.getByText(label)).toBeVisible();
      await expect(nav.getByRole('link', { name: label })).toHaveCount(0);
    }

    // The one cookie.
    const cookies = await context.cookies();
    expect(cookies.map((cookie) => cookie.name)).toEqual([COOKIE]);
    const [cookie] = cookies;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(cookie.path).toBe('/');
    const lifetime = cookie.expires - Date.now() / 1000;
    expect(lifetime).toBeGreaterThan(7.9 * 3600);
    expect(lifetime).toBeLessThan(8.1 * 3600);
    // Opaque: nothing readable in the value.
    const value = decodeURIComponent(cookie.value);
    expect(value).not.toContain('@');
    expect(value.toLowerCase()).not.toContain('example');
    expect(value).not.toContain(PASSWORD);
    // Not reachable from script.
    expect(await page.evaluate(() => document.cookie)).toBe('');
  });

  test('admin pages are noindex and no-store, and a signed-in visit to sign-in goes on to the shell (AC 23, 24)', async ({
    page,
  }) => {
    await signIn(page);
    const response = await page.goto('/admin');
    expect(response?.headers()['x-robots-tag']).toMatch(/noindex/);
    expect(response?.headers()['cache-control']).toMatch(/no-store/);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    await page.goto('/admin/acceso');
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test('a signed-in visit to an address that does not exist shows the public 404, not an admin page', async ({ page }) => {
    await signIn(page);
    const response = await page.goto('/admin/registro');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: messages.NotFound.heading })).toBeVisible();
  });

  test('signing out ends the session on the server, clears the cookie and lands on sign-in (AC 15, 20)', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await signIn(page);
    const [live] = await context.cookies();
    expect(live.name).toBe(COOKIE);

    await page.getByTestId('admin-sign-out').click();
    await expect(page).toHaveURL(/\/admin\/acceso\?aviso=salida/);
    await expect(page.getByTestId('admin-notice')).toHaveText(admin.SignIn.signedOut);
    expect((await context.cookies()).filter((cookie) => cookie.name === COOKIE)).toEqual([]);

    // The back button never redisplays the shell from cache.
    await page.goBack();
    await expect(page.getByTestId('admin-identity')).toHaveCount(0);

    // Another browser holding the old value is anonymous (the session is gone on the server).
    const other = await browser.newContext({ baseURL });
    await other.addCookies([{ name: live.name, value: live.value, domain: live.domain, path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const otherPage = await other.newPage();
    await otherPage.goto('/admin');
    await expect(otherPage).toHaveURL(/\/admin\/acceso/);
    await expect(otherPage.getByTestId('admin-identity')).toHaveCount(0);
    await other.close();
  });

  test('a forged cookie is treated as no cookie (AC 19)', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const host = new URL(baseURL ?? 'http://127.0.0.1').hostname;
    await context.addCookies([{ name: COOKIE, value: 'forged.value', domain: host, path: '/' }]);
    const page = await context.newPage();
    const response = await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/acceso/);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByTestId('admin-identity')).toHaveCount(0);
    await context.close();
  });
});

test.describe('the public site is unchanged (AC 26)', () => {
  test('shows no link to the admin area and keeps its header, footer and no cookie', async ({ page, context }) => {
    // The two pages that need no owner identity (the others answer 500 while it is blank).
    for (const url of ['/', '/como-nos-financiamos']) {
      const response = await page.goto(url);
      expect(response?.headers()['set-cookie'], url).toBeUndefined();
      await expect(page.locator('a[href^="/admin"]'), url).toHaveCount(0);
      await expect(page.getByRole('contentinfo'), url).toHaveCount(1);
    }
    expect(await context.cookies()).toEqual([]);
  });
});
