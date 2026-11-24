import { compose, E2E_ADMIN, type E2EService, verb } from '../support/e2e-stack';

import { removeStack } from './global-teardown';

// Runs once before the whole e2e run (Playwright `globalSetup`, TD-38, #363). The e2e run owns its stack:
// the Compose project `los-tres-e2e` (compose.yaml plus tests/e2e/compose.e2e.yaml; the name, the files and
// the ports come from playwright.config.ts). This builds the app image, starts the database, the app and
// the three variant apps on a fresh volume, imports the demo feeds through the real `import-feeds` verb,
// and creates the one admin. Nothing here touches the development stack. tests/e2e/global-teardown.ts
// removes the project afterwards, on every exit path; the removal at the start of this setup is for a
// run that was killed before its teardown could run. The import output holds ids, shop names, counts
// and codes only (never a feed URL), so it is safe to print on failure.

const NO_FEED_MESSAGE =
  'e2e setup: the import found no approved feed. Set SEED_DEMO_DATA=true in .env and run the e2e again';

/** The services that get their own import: each runs on a database of its own. */
const IMPORTED: E2EService[] = ['app', 'app-flag-off', 'app-flag-on'];

const seconds = (since: number): string => ((Date.now() - since) / 1000).toFixed(1);

const lastLines = (text: string, count: number): string => text.trim().split(/\r?\n/).slice(-count).join('\n');

function importFeeds(service: E2EService): void {
  const result = verb(service, ['import-feeds'], { timeout: 180_000 });
  const out = result.stdout;

  const total = /^total: feeds=(\d+) imported=(\d+) skipped=(\d+) failed=(\d+)$/m.exec(out);
  if (result.status === 0 && total && Number(total[1]) === 0) {
    throw new Error(NO_FEED_MESSAGE);
  }
  if (result.status !== 0 || !total || Number(total[4]) > 0) {
    throw new Error(`e2e setup: import-feeds on ${service} failed (exit ${result.status ?? 'none'})\n${out.trim()}`);
  }
  if (Number(total[2]) < 2) {
    throw new Error(`e2e setup: expected at least 2 feeds to import on ${service}, got ${total[2]}. ${NO_FEED_MESSAGE}`);
  }
}

export default function globalSetup(): void {
  const phases: Array<[string, number]> = [];
  const phase = <T>(name: string, run: () => T): T => {
    const started = Date.now();
    try {
      return run();
    } finally {
      phases.push([name, Date.now() - started]);
    }
  };
  const begun = Date.now();

  phase('clean', removeStack);

  phase('build', () => {
    const built = compose(['build', 'app'], { timeout: 900_000 });
    if (built.status !== 0) {
      throw new Error(`e2e setup: the app image did not build (exit ${built.status ?? 'none'})\n${lastLines(`${built.stdout}${built.stderr}`, 60)}`);
    }
  });

  phase('up', () => {
    const started = compose(['up', '-d', '--wait', '--wait-timeout', '300'], { timeout: 420_000 });
    if (started.status !== 0) {
      const logs = compose(['logs', '--no-color', '--tail=100'], { timeout: 60_000 });
      const failure = `${started.stdout}${started.stderr}`;
      const hint = /port is already allocated|address already in use|ports are not available/i.test(failure)
        ? '\nA port is taken: set E2E_APP_PORT in .env (four consecutive ports are used)'
        : '';
      throw new Error(
        `e2e setup: the e2e stack did not start (exit ${started.status ?? 'none'})${hint}\n${lastLines(failure, 30)}\n${logs.stdout}${logs.stderr}`.trim(),
      );
    }
  });

  phase('import', () => {
    for (const service of IMPORTED) importFeeds(service);
  });

  phase('admin', () => {
    const created = verb('app', ['create-admin'], { input: `${E2E_ADMIN.email}\n${E2E_ADMIN.password}\n`, timeout: 80_000 });
    const out = `${created.stdout}${created.stderr}`;
    // create-admin never repeats what it was given, so the output is safe to print.
    if (created.status !== 0 || !/create-admin: created/.test(out)) {
      throw new Error(`e2e setup: create-admin exited ${created.status ?? 'none'}\n${out.trim()}`);
    }
  });

  const times = Object.fromEntries(phases);
  const part = (name: string): string => ((times[name] ?? 0) / 1000).toFixed(1);
  console.log(
    `e2e stack: ready in ${seconds(begun)} s (clean ${part('clean')}, build ${part('build')}, up ${part('up')}, import ${part('import')}, admin ${part('admin')})`,
  );
}
