import { spawnSync } from 'node:child_process';

import { expect, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';

// Sign-in for an e2e spec that owns its own admin account. Each spec uses its own email: creating
// an admin again ends that admin's sessions, so two specs must never share one (admin.spec.ts owns
// the first account). There is no delete verb, so an account stays in the development database.

const UNAVAILABLE_HINT =
  'admin e2e: the stack answered "unavailable". Set AUTH_SECRET (32+ characters) and SITE_URL=http://127.0.0.1:<APP_PORT> in .env, then run: docker compose up -d';

/** Creates, or resets the password of, an admin through the Compose `create-admin` command. */
export function createAdminWithCommand(email: string, password: string, spec: string): void {
  const result = spawnSync('docker', ['compose', 'run', '--rm', '-T', '--no-deps', 'app', 'create-admin'], {
    input: `${email}\n${password}\n`,
    encoding: 'utf8',
    timeout: 80_000,
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`${spec}: create-admin exited ${result.status ?? 'none'}. Is the stack up with the new image? Run: npm run stack:up\n${out.trim()}`);
  }
  expect(out).toMatch(/create-admin: (created|updated, sessions ended)/);
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

function runPsql(statement: string, flags: string): string {
  const result = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'sh', '-c', `psql -U "$POSTGRES_USER" "$POSTGRES_DB" -v ON_ERROR_STOP=1 ${flags} -c "${statement.replace(/"/g, '\\"')}"`],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (result.status !== 0) throw new Error(`psql failed (exit ${result.status ?? 'none'}): ${result.stderr?.trim() ?? ''}`);
  return result.stdout ?? '';
}

/** Runs one SQL statement as the database owner inside the Compose `db` container. */
export function psql(statement: string): string {
  return runPsql(statement, '');
}

/** Runs one SQL query and returns its single value, trimmed (psql `-tA`). */
export function psqlScalar(statement: string): string {
  return runPsql(statement, '-tA').trim();
}
