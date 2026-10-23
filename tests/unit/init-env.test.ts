import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// `npm run env:init` (scripts/init-env.mjs): creates .env once from
// .env.example, fills blank secrets, derives DATABASE_URL, never overwrites,
// never prints a secret. The script resolves the repo root from its own
// location, so it is copied with .env.example into a temp tree and run there:
// the real .env is never read or touched.

const repo = process.cwd();
let tree: string;

function run() {
  return spawnSync(process.execPath, [path.join(tree, 'scripts', 'init-env.mjs')], {
    cwd: tree,
    encoding: 'utf8',
  });
}

function parse(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

beforeEach(() => {
  tree = mkdtempSync(path.join(os.tmpdir(), 'init-env-'));
  mkdirSync(path.join(tree, 'scripts'));
  copyFileSync(path.join(repo, 'scripts', 'init-env.mjs'), path.join(tree, 'scripts', 'init-env.mjs'));
  copyFileSync(path.join(repo, '.env.example'), path.join(tree, '.env.example'));
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
});

describe('scripts/init-env.mjs', () => {
  it('creates .env with 48-hex secrets, a derived DATABASE_URL and the demo seed on', () => {
    const result = run();
    expect(result.status).toBe(0);

    const envPath = path.join(tree, '.env');
    expect(existsSync(envPath)).toBe(true);
    const values = parse(readFileSync(envPath, 'utf8'));
    const example = parse(readFileSync(path.join(tree, '.env.example'), 'utf8'));

    expect(values.get('DB_PASSWORD')).toMatch(/^[0-9a-f]{48}$/);
    expect(values.has('UMAMI_APP_SECRET')).toBe(false);
    expect(values.get('DATABASE_URL')).toBe(
      `postgres://${example.get('DB_USER')}:${values.get('DB_PASSWORD')}@127.0.0.1:${example.get('DB_HOST_PORT')}/${example.get('DB_NAME')}`,
    );
    expect(values.get('SEED_DEMO_DATA')).toBe('true');
    expect(values.get('SITE_NAME')).toBe(example.get('SITE_NAME'));
  });

  it('generates a distinct 48-hex AUTH_SECRET and derives SITE_URL from APP_PORT (US-2.1)', () => {
    expect(run().status).toBe(0);
    const values = parse(readFileSync(path.join(tree, '.env'), 'utf8'));
    const example = parse(readFileSync(path.join(tree, '.env.example'), 'utf8'));

    // The example ships both blank, so a committed file holds no secret.
    expect(example.get('AUTH_SECRET')).toBe('');
    expect(example.get('SITE_URL')).toBe('');

    expect(values.get('AUTH_SECRET')).toMatch(/^[0-9a-f]{48}$/);
    expect(values.get('AUTH_SECRET')).not.toBe(values.get('DB_PASSWORD'));
    expect(values.get('SITE_URL')).toBe(`http://127.0.0.1:${values.get('APP_PORT')}`);
  });

  it('generates a different AUTH_SECRET on every run', () => {
    expect(run().status).toBe(0);
    const first = parse(readFileSync(path.join(tree, '.env'), 'utf8')).get('AUTH_SECRET');
    rmSync(path.join(tree, '.env'));
    expect(run().status).toBe(0);
    const second = parse(readFileSync(path.join(tree, '.env'), 'utf8')).get('AUTH_SECRET');
    expect(first).not.toBe(second);
  });

  it('prints no secret to stdout or stderr', () => {
    const result = run();
    const values = parse(readFileSync(path.join(tree, '.env'), 'utf8'));
    const printed = `${result.stdout}${result.stderr}`;
    for (const name of ['DB_PASSWORD', 'AUTH_SECRET', 'DATABASE_URL']) {
      expect(printed).not.toContain(values.get(name) as string);
    }
  });

  it('exits 1 on a second run and leaves .env byte-identical', () => {
    expect(run().status).toBe(0);
    const envPath = path.join(tree, '.env');
    const before = readFileSync(envPath);

    const second = run();
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('already exists');
    expect(readFileSync(envPath).equals(before)).toBe(true);
  });
});
