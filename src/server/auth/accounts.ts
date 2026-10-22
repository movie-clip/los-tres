import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { adminAccounts, adminSessions, adminUsers } from '../../db/schema';
import { ADMIN_NAME, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './config';

// Admin accounts exist only through this file, called by the create-admin
// command (AC 1, AC 2). It imports Drizzle and the password hash only, never
// `getAuth()`, so the CLI's import graph holds no next/headers.

/** The same address rule Better Auth applies at sign-in (zod's email pattern), so an address accepted here can sign in. */
const EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** Why a credential pair is refused. Names the rule, never the value. */
export type AdminInputProblem = 'email-missing' | 'email-invalid' | 'password-missing' | 'password-short' | 'password-long';

/** Trimmed and lowercased: every lookup and write of an email goes through this (AC 7). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The first rule the pair breaks, or null when both are acceptable. */
export function checkAdminInput(email: string, password: string): AdminInputProblem | null {
  const normalized = normalizeEmail(email);
  if (normalized === '') return 'email-missing';
  if (!EMAIL_PATTERN.test(normalized)) return 'email-invalid';
  if (password === '') return 'password-missing';
  if (password.length < PASSWORD_MIN_LENGTH) return 'password-short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'password-long';
  return null;
}

/** Thrown by `upsertAdmin` for a pair `checkAdminInput` refuses. Carries the rule, never the value. */
export class AdminInputError extends Error {
  constructor(readonly problem: AdminInputProblem) {
    super(problem);
    this.name = 'AdminInputError';
  }
}

export type UpsertAdminResult = {
  /** `created`: a new account. `updated`: the password was replaced and the admin's sessions ended. */
  outcome: 'created' | 'updated';
  userId: string;
};

/**
 * Creates the admin account for an email, or replaces its password and ends all
 * of that admin's sessions (D-12). One transaction. The password is hashed with
 * Better Auth's scrypt (salted), so a hash made here signs in through
 * `signInEmail`. The email is stored trimmed and lowercased; two spellings that
 * differ only in case are one account. Throws `AdminInputError` for a pair that
 * `checkAdminInput` refuses, before touching the database.
 */
export async function upsertAdmin(db: Database, email: string, password: string): Promise<UpsertAdminResult> {
  const problem = checkAdminInput(email, password);
  if (problem) throw new AdminInputError(problem);
  const normalized = normalizeEmail(email);
  // Hashing is slow by design: do it before the transaction opens. A dynamic
  // import because better-auth is ESM-only and the CLI is compiled to CommonJS,
  // where tsc refuses a static import of it (TS1479); `import()` is kept as is.
  const { hashPassword } = await import('better-auth/crypto');
  const hash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(adminUsers)
      .values({ id: randomUUID(), name: ADMIN_NAME, email: normalized })
      .onConflictDoNothing({ target: adminUsers.email })
      .returning({ id: adminUsers.id });

    if (inserted.length > 0) {
      const userId = inserted[0].id;
      await tx.insert(adminAccounts).values({
        id: randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: hash,
      });
      return { outcome: 'created', userId };
    }

    const [existing] = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, normalized))
      .for('update');
    const userId = existing.id;
    const now = new Date();
    const updated = await tx
      .update(adminAccounts)
      .set({ password: hash, updatedAt: now })
      .where(and(eq(adminAccounts.userId, userId), eq(adminAccounts.providerId, 'credential')))
      .returning({ id: adminAccounts.id });
    if (updated.length === 0) {
      await tx.insert(adminAccounts).values({
        id: randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: hash,
      });
    }
    await tx.update(adminUsers).set({ updatedAt: now }).where(eq(adminUsers.id, userId));
    await tx.delete(adminSessions).where(eq(adminSessions.userId, userId));
    return { outcome: 'updated', userId };
  });
}

/**
 * Test helper: creates (or re-creates) an admin and returns its user id. The
 * same code path as the command, so a test account signs in exactly like a real
 * one. Not for production callers; use `upsertAdmin`.
 */
export async function createAdminForTest(db: Database, email: string, password: string): Promise<string> {
  const { userId } = await upsertAdmin(db, email, password);
  return userId;
}
