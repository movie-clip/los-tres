import { expect, test as base, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';

import { E2E_ADMIN, origin, verb } from './e2e-stack';

// Sign-in for the admin e2e specs (#363). The e2e run creates one admin, `E2E_ADMIN`, once, in its global
// setup, on a database that is fresh for the run; every admin spec signs in as that account with
// `signInAsAdmin`. No spec creates that email again: `create-admin` on an existing email ends that
// admin's sessions, which would sign the other specs out. The one test whose subject is the command itself
// (admin.spec.ts) creates an account of its own with `createAdminWithCommand`.

const UNAVAILABLE_HINT =
  'admin e2e: the stack answered "unavailable". Set AUTH_SECRET (32+ characters) in .env and run the e2e again';

/**
 * Creates, or resets the password of, an admin through the `create-admin` verb inside the running e2e `app`
 * service, and returns the command's output. Only the test of the command itself calls this: it must never be
 * given `E2E_ADMIN`'s email, whose sessions the other specs hold.
 */
export function createAdminWithCommand(email: string, password: string, spec: string): string {
  expect(email, `${spec}: createAdminWithCommand must not touch the shared e2e admin`).not.toBe(E2E_ADMIN.email);
  const result = verb('app', ['create-admin'], { input: `${email}\n${password}\n`, timeout: 80_000 });
  const out = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) {
    throw new Error(`${spec}: create-admin exited ${result.status ?? 'none'}\n${out.trim()}`);
  }
  expect(out).toMatch(/create-admin: (created|updated, sessions ended)/);
  return out;
}

/** Signs in through the sign-in form and waits for the admin identity. */
export async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/admin/acceso');
  await page.locator('#admin-email').fill(email);
  await page.locator('#admin-password').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('admin-identity')).toBeVisible({ timeout: 20_000 }).catch(async (error) => {
    if (await page.getByText(messages.Admin.SignIn.unavailable).count()) throw new Error(UNAVAILABLE_HINT);
    throw error;
  });
}

/** Signs in as the one e2e admin the global setup created. */
export async function signInAsAdmin(page: Page): Promise<void> {
  await signInAs(page, E2E_ADMIN.email, E2E_ADMIN.password);
}

// One sign-in per worker (#339). `adminTest` is `test` with a worker-scoped fixture, `adminSession`, that signs in as
// `E2E_ADMIN` once in a context of its own and keeps `context.storageState()` in memory only: it is never written to
// disk, because `test-results/` is uploaded when a run fails on CI (#361) and a session token has no place there. Each
// test then gets a `page` whose context starts from that state, already signed in. Use it for a test that only needs
// an admin page open; a test whose subject is the sign-in form itself (admin.spec.ts) calls `signInAsAdmin`, which is
// unchanged. The session is shared by every test of the worker, so no test using `adminTest` may sign `E2E_ADMIN` out
// or create that email again: either ends the session for the rest of the worker.

type AdminSession = Awaited<ReturnType<BrowserContext['storageState']>>;

// The fixture callbacks name their second argument `provide`: Playwright calls it `use`, which the React hooks
// lint rule mistakes for the React hook of that name.
export const adminTest = base.extend<{ publicRequest: APIRequestContext }, { adminSession: AdminSession }>({
  adminSession: [
    async ({ browser }, provide) => {
      const context = await browser.newContext({ baseURL: origin('app') });
      try {
        await signInAsAdmin(await context.newPage());
        await provide(await context.storageState());
      } finally {
        await context.close();
      }
    },
    { scope: 'worker' },
  ],
  storageState: async ({ adminSession }, provide) => {
    await provide(adminSession);
  },
  // The public site as an anonymous visitor sees it: the `request` fixture can carry the signed-in state above, so a
  // test that reads public answers beside an admin page asks for this one, which holds no cookie.
  publicRequest: async ({ playwright, baseURL }, provide) => {
    const context = await playwright.request.newContext({ baseURL });
    try {
      await provide(context);
    } finally {
      await context.dispose();
    }
  },
});
