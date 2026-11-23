import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// S12.2 (decision 0017), ACs 39 to 41: collected files can never enter git or the image, and the local flag is
// off in every tracked file. The folder's contents are ignored by git and left out of the Docker build context,
// only the placeholder is tracked, compose mounts it read-only; no tracked file sets the flag on, `.env.example`
// and `npm run env:init` write no value for it, and compose passes it with the default off. Removing a line
// fails a test here. The pattern is ignore-rules.test.ts (the catalogue folder, S3.7), which stays as it is.
// "Tracked" is what `git ls-files` says, never a walk of the tree: the owner's own untracked `.env` may
// hold the flag, and must not fail the suite.

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(path.resolve(ROOT, file), 'utf8');
const lines = (file: string): string[] =>
  read(file)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

function git(args: string[]): { status: number | null; out: string } {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error('git is needed to list the tracked files');
  return { status: result.status, out: result.stdout ?? '' };
}

describe('collected folder ignore rules (AC 40, 41)', () => {
  it('.gitignore ignores the folder contents and keeps only the placeholder, the ignore first', () => {
    const rules = lines('.gitignore');
    expect(rules).toContain('/collected-files/*');
    expect(rules).toContain('!/collected-files/.gitkeep');
    expect(rules.indexOf('/collected-files/*')).toBeLessThan(rules.indexOf('!/collected-files/.gitkeep'));
  });

  it('.dockerignore leaves the whole folder out of the build context', () => {
    expect(lines('.dockerignore')).toContain('collected-files');
  });

  it('compose mounts the folder read-only into app, beside the catalogue folder, and the Dockerfile never names it', () => {
    const compose = read('compose.yaml');
    expect(compose).toMatch(/type:\s*bind\s+source:\s*\.\/collected-files\s+target:\s*\/app\/collected-files\s+read_only:\s*true/);
    // The two mounts are separate: a collected file is never reachable at the catalogue path.
    expect(compose).toMatch(/source:\s*\.\/catalogue-files\s+target:\s*\/app\/catalogue-files\s+read_only:\s*true/);
    expect(compose.match(/target:\s*\/app\/collected-files/g)).toHaveLength(1);
    expect(read('Dockerfile')).not.toContain('collected-files');
  });

  it('tracks an empty placeholder in the folder, so a clone has the folder before Docker does', () => {
    expect(read('collected-files/.gitkeep')).toBe('');
  });

  it('git tracks nothing in the folder but the placeholder, whatever the owner has put there', () => {
    const tracked = git(['ls-files', '-z', '--', 'collected-files']).out.split('\0').filter(Boolean);
    expect(tracked).toEqual(['collected-files/.gitkeep']);
  });

  it.each(['collected-files/precios.csv', 'collected-files/precios.xml.gz', 'collected-files/sub/otro.csv', 'collected-files/.hidden', 'collected-files/README.md'])(
    'git ignores a file put at %s, and does not ignore the placeholder (the rule works, not only its text)',
    (file) => {
      expect(git(['check-ignore', '-q', '--no-index', file]).status).toBe(0);
      expect(git(['check-ignore', '-q', '--no-index', 'collected-files/.gitkeep']).status).toBe(1);
    },
  );
});

// ---------- AC 39: the flag is absent by default ----------

/** True when a text sets the flag on: `NAME=true`, `NAME: true`, `NAME: "true"`, `ENV NAME true`, any case of the value. */
function setsFlagOn(text: string): boolean {
  return /LOCAL_COLLECTED_DATA['"]?(?:\s*[:=]\s*|\s+)['"]?\s*true\b/i.test(text);
}

describe('the flag is set on in no tracked file (AC 39)', () => {
  const tracked = git(['ls-files', '-z']).out.split('\0').filter(Boolean);
  // tests/** and *.md carry the flag by design (these tests, the owner's guide), and agentic/ holds run records
  // that are never built, never mounted and left out of the image (.dockerignore).
  const scanned = tracked.filter((file) => !file.startsWith('tests/') && !file.startsWith('agentic/') && !file.endsWith('.md'));

  it('scans a tree it has actually listed (non-vacuity)', () => {
    expect(scanned.length).toBeGreaterThan(150);
    expect(scanned).toEqual(
      expect.arrayContaining(['compose.yaml', '.env.example', 'Dockerfile', 'package.json', 'docker-entrypoint.sh', 'scripts/init-env.mjs']),
    );
    expect(scanned.some((file) => file.startsWith('.github/workflows/'))).toBe(true);
  });

  it('finds no tracked file outside tests, *.md and agentic that sets it on', () => {
    const offenders = scanned.filter((file) => setsFlagOn(readFileSync(path.resolve(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it.each([
    ['an env line', 'LOCAL_COLLECTED_DATA=true\n'],
    ['an env line in capitals', 'LOCAL_COLLECTED_DATA=TRUE\n'],
    ['an exported env line', 'export LOCAL_COLLECTED_DATA=true\n'],
    ['a compose entry', '    environment:\n      LOCAL_COLLECTED_DATA: true\n'],
    ['a quoted compose entry', '      LOCAL_COLLECTED_DATA: "true"\n'],
    ['a one-off container flag', 'docker compose run -e LOCAL_COLLECTED_DATA=true app\n'],
    ['a Dockerfile ENV with an equals sign', 'ENV LOCAL_COLLECTED_DATA=true\n'],
    ['a Dockerfile ENV with a space', 'ENV LOCAL_COLLECTED_DATA true\n'],
    ['a package script', '"dev": "LOCAL_COLLECTED_DATA=true next dev"\n'],
    ['a workflow value', '        env:\n          LOCAL_COLLECTED_DATA: true\n'],
    ['a value with spaces round the sign', 'LOCAL_COLLECTED_DATA = true\n'],
  ])('is shown to catch %s', (_label, text) => {
    expect(setsFlagOn(text)).toBe(true);
  });

  it.each([
    ['the compose pass-through with the default off', '      LOCAL_COLLECTED_DATA: ${LOCAL_COLLECTED_DATA:-false}\n'],
    ['an explicit off', 'LOCAL_COLLECTED_DATA=false\n'],
    ['an empty value', 'LOCAL_COLLECTED_DATA=\n'],
    ['prose about the flag', '# Beside a SITE_URL that is not loopback the app refuses to start; LOCAL_COLLECTED_DATA is on only for true.\n'],
    ['the refusal line', 'start refused: LOCAL_COLLECTED_DATA is on and SITE_URL is not a loopback origin\n'],
    ['a longer name', 'LOCAL_COLLECTED_DATA_EXTRA=true\n'],
  ])('is not tripped by %s', (_label, text) => {
    expect(setsFlagOn(text)).toBe(false);
  });

  it('.env.example has no line that sets the flag, though it may mention it in a comment', () => {
    const assigned = read('.env.example')
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('#') && /LOCAL_COLLECTED_DATA/.test(line));
    expect(assigned).toEqual([]);
  });

  it('compose passes the flag through with the default off, and sets it nowhere else', () => {
    const compose = read('compose.yaml');
    expect(compose).toContain('LOCAL_COLLECTED_DATA: ${LOCAL_COLLECTED_DATA:-false}');
    expect(compose.match(/^\s+LOCAL_COLLECTED_DATA:/gm)).toHaveLength(1);
    expect(setsFlagOn(compose)).toBe(false);
  });
});

describe('npm run env:init writes no value for the flag (AC 39)', () => {
  let tree: string;
  beforeEach(() => {
    tree = mkdtempSync(path.join(os.tmpdir(), 'init-env-flag-'));
    mkdirSync(path.join(tree, 'scripts'));
    copyFileSync(path.join(ROOT, 'scripts', 'init-env.mjs'), path.join(tree, 'scripts', 'init-env.mjs'));
    copyFileSync(path.join(ROOT, '.env.example'), path.join(tree, '.env.example'));
  });
  afterEach(() => {
    rmSync(tree, { recursive: true, force: true });
  });

  it('creates a .env that does not set it, so a fresh clone starts with the flag off', () => {
    const result = spawnSync(process.execPath, [path.join(tree, 'scripts', 'init-env.mjs')], { cwd: tree, encoding: 'utf8' });
    expect(result.status).toBe(0);

    const env = readFileSync(path.join(tree, '.env'), 'utf8');

    expect(env).toContain('SEED_DEMO_DATA=true');
    expect(env).not.toMatch(/^\s*LOCAL_COLLECTED_DATA\s*=/m);
    expect(setsFlagOn(env)).toBe(false);
  });
});
