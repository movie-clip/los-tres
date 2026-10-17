import { spawnSync } from 'node:child_process';

// Runs once before the whole e2e run (Playwright `globalSetup`, TD-38). The
// product pages need data, and the real path to data is the import, so this
// runs `docker compose run --rm -T --no-deps app import-feeds` against the
// Compose stack that `npm run stack:up` started. Tests never write the
// development database themselves. The import is idempotent, so running it on
// every e2e run is harmless. The output holds ids, shop names, counts and
// codes only (never a feed URL), so it is safe to print on failure.

const NO_FEED_MESSAGE =
  'e2e setup: the import found no approved feed. Set SEED_DEMO_DATA=true in .env and run: docker compose up -d';

export default function globalSetup(): void {
  const result = spawnSync(
    'docker',
    ['compose', 'run', '--rm', '-T', '--no-deps', 'app', 'import-feeds'],
    { encoding: 'utf8', timeout: 180_000 },
  );
  const out = `${result.stdout ?? ''}`;

  const total = /^total: feeds=(\d+) imported=(\d+) skipped=(\d+) failed=(\d+)$/m.exec(out);
  if (result.status === 0 && total && Number(total[1]) === 0) {
    throw new Error(NO_FEED_MESSAGE);
  }
  if (result.status !== 0 || !total || Number(total[4]) > 0) {
    throw new Error(
      `e2e setup: import-feeds failed (exit ${result.status ?? 'none'}). Is the stack up? Run: npm run stack:up\n${out.trim()}`,
    );
  }
  if (Number(total[2]) < 2) {
    throw new Error(`e2e setup: expected the 2 demo feeds to import, got ${total[2]}. ${NO_FEED_MESSAGE}`);
  }
}
