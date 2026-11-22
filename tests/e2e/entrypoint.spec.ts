import { spawnSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { DEMO_COUNTS } from '../fixtures/demo';

// The image's verb dispatcher, through `docker compose run` (not `sh`, which is
// not reliably on the Windows host). `--no-deps` because the stack is already
// up. Serial: the import runs twice and the second must see the first.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

function composeRun(...args: string[]) {
  const result = spawnSync('docker', ['compose', 'run', '--rm', '-T', '--no-deps', 'app', ...args], {
    encoding: 'utf8',
    timeout: 100_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test.describe('app image entrypoint', () => {
  test('an unknown verb prints the usage line and exits 64', () => {
    const result = composeRun('bogus');
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('usage: docker-entrypoint.sh');
  });

  test('the usage line for an unknown verb lists create-admin', () => {
    expect(composeRun('bogus').stderr).toContain('create-admin');
  });

  test('create-admin with no input exits 2 with a usage line and creates nothing', () => {
    const result = composeRun('create-admin');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: create-admin');
  });

  test('create-admin refuses an argument, so a password cannot be given on the command line', () => {
    const result = composeRun('create-admin', '--password', 'argv-sentinel-4412');
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain('argv-sentinel-4412');
  });

  test('import-feeds run twice: the second run creates nothing', () => {
    const first = composeRun('import-feeds');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(
      `total: feeds=${DEMO_COUNTS.feeds} imported=${DEMO_COUNTS.feeds} skipped=0 failed=0`,
    );

    const second = composeRun('import-feeds');
    expect(second.status).toBe(0);
    const feedLines = second.stdout.split('\n').filter((line) => line.startsWith('feed '));
    expect(feedLines).toHaveLength(DEMO_COUNTS.feeds);
    for (const line of feedLines) {
      expect(line).toContain('products_created=0');
      expect(line).toContain('offers_created=0');
      // S3.3: the demo files are unchanged between runs, so nothing is missing and nothing is removed.
      expect(line).toContain('offers_removed=0');
      // S5.6, AC 29: the demo feeds name only vehicles of the list.
      expect(line).toMatch(/ unknown_vehicles=0$/);
    }
    expect(second.stdout).not.toContain('fitment: unknown vehicle');
    expect(second.stdout).not.toContain('removal:');
  });

  test('import-feeds prints no feed URL', () => {
    const result = composeRun('import-feeds');
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/demo-feed:|https?:\/\/|\.example/);
  });

  test('import-feeds --feed with an unregistered id exits 1', () => {
    const result = composeRun('import-feeds', '--feed', '999999');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not registered');
  });

  test('import-feeds with a bad argument exits 2', () => {
    const result = composeRun('import-feeds', '--feed', 'abc');
    expect(result.status).toBe(2);
  });

  // S3.3, AC 12: the override is accepted only as the third argument, after `--feed <id>`.
  test('import-feeds --feed <id> --allow-large-removal reaches the importer: an unregistered id still exits 1', () => {
    const result = composeRun('import-feeds', '--feed', '999999', '--allow-large-removal');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not registered');
    expect(result.stderr).not.toContain('usage:');
  });

  for (const args of [['--allow-large-removal'], ['--allow-large-removal', '--feed', '1'], ['--feed', '1', '--allow-large-removal', 'x']]) {
    test(`import-feeds ${args.join(' ')} prints the usage line and exits 2`, () => {
      const result = composeRun('import-feeds', ...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('usage: import-feeds [--feed <id> [--allow-large-removal]]');
      expect(result.stdout).not.toContain('feed ');
    });
  }

  test('seed --if-enabled exits 0 and prints no secret', () => {
    const result = composeRun('seed', '--if-enabled');
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/postgres:\/\/|DB_PASSWORD/);
  });
});
