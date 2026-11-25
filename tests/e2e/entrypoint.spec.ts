import { expect, test } from '@playwright/test';

import { verb } from '../support/e2e-stack';

// The image's verb dispatcher, `./docker-entrypoint.sh <verb>` (B8 of #339), run inside the e2e `app-no-db`
// container that is already up (#363: a spec starts no container). `app-no-db` is the same image with a
// database nobody listens on, and the two tests below end before any verb reaches a database, so this spec
// writes no database and runs in the parallel project. The import verbs are proved elsewhere: the global setup
// runs `import-feeds` on every e2e database before the first test, the importer's idempotence and output are
// integration/importer-demo.test.ts and importer-logging.test.ts, and the argument forms are
// unit/import-feeds-cli.test.ts.
test.describe.configure({ timeout: 120_000 });

function composeRun(...args: string[]) {
  return verb('app-no-db', args, { timeout: 100_000 });
}

test.describe('app image entrypoint', () => {
  test('an unknown verb, and start-check, which is a pre-step and not a verb, print the usage line naming the verbs and exit 64', () => {
    for (const name of ['bogus', 'start-check']) {
      const result = composeRun(name);
      expect(result.status, name).toBe(64);
      expect(result.stderr, name).toContain('usage: docker-entrypoint.sh');
      expect(result.stderr, name).toContain('create-admin');
    }
  });

  test('create-admin refuses an argument, so a password cannot be given on the command line', () => {
    const result = composeRun('create-admin', '--password', 'argv-sentinel-4412');
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain('argv-sentinel-4412');
  });
});
