import { getDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { runCli } from './shared';

// Applies pending migrations. Run as `npm run db:migrate` or the `migrate`
// image verb; the `server` verb runs it on every start.
void runCli('migrate', async () => {
  if (process.argv.length > 2) {
    console.error('usage: migrate');
    return 2;
  }
  await runMigrations(getDb());
  console.log('migrate: up to date');
  return 0;
});
