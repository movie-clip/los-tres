import { getDb } from '../db/client';
import { checkAdminInput, upsertAdmin, type AdminInputProblem } from '../server/auth/accounts';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../server/auth/config';
import { runCli } from './shared';
import { readCredentials } from './stdin';

const USAGE = 'usage: create-admin  (reads email, then password, from stdin)';

// What a refusal says. Names the rule, never the value (AC 5, AC 28).
const REFUSALS: Record<AdminInputProblem, string> = {
  'email-missing': 'no email given',
  'email-invalid': 'the email is not a valid address',
  'password-missing': 'no password given',
  'password-short': `the password must have at least ${PASSWORD_MIN_LENGTH} characters`,
  'password-long': `the password must have at most ${PASSWORD_MAX_LENGTH} characters`,
};

// Creates an admin account, or replaces the password of an existing one and ends
// that admin's sessions (D-12). Takes no arguments: npm echoes script arguments,
// so an email or a password there would be printed. Run as
// `npm run create-admin` or the `create-admin` image verb.
void runCli('create-admin', async () => {
  if (process.argv.length > 2) {
    console.error(USAGE);
    return 2;
  }
  const { email, password } = await readCredentials();
  const problem = checkAdminInput(email, password);
  if (problem) {
    console.error(`create-admin: ${REFUSALS[problem]}`);
    console.error(USAGE);
    return 2;
  }
  const { outcome } = await upsertAdmin(getDb(), email, password);
  console.log(outcome === 'created' ? 'create-admin: created' : 'create-admin: updated, sessions ended');
  return 0;
});
