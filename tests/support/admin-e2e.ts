import { expect, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';

import { E2E_ADMIN, verb } from './e2e-stack';

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
