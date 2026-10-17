import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// File-scan tests that keep the guardrail seams single-sourced. Each rule says
// where a thing may live; a second copy anywhere else fails the scan. They read
// source text, so they need neither a database nor a build.

const root = process.cwd();
const SOURCE_FILE = /\.(ts|tsx|mts|js|jsx|mjs)$/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** Source files under src/, as posix paths relative to the repo root, with code stripped of comments. */
function sources(): { file: string; code: string }[] {
  return walk(path.join(root, 'src'))
    .filter((full) => SOURCE_FILE.test(full))
    .map((full) => ({
      file: path.relative(root, full).split(path.sep).join('/'),
      code: stripComments(readFileSync(full, 'utf8')),
    }));
}

/** Drops block comments and line comments (not a `//` that follows a colon, as in a URL). */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

function offenders(pattern: RegExp, allowed: (file: string) => boolean): string[] {
  return sources()
    .filter(({ file, code }) => pattern.test(code) && !allowed(file))
    .map(({ file }) => file);
}

describe('seams (guardrails 1, 2, 4)', () => {
  it('finds the source tree it scans', () => {
    const files = sources().map(({ file }) => file);
    expect(files).toEqual(
      expect.arrayContaining([
        'src/server/visibility.ts',
        'src/server/importer/source.ts',
        'src/server/money.ts',
      ]),
    );
  });

  it('names the approval, hidden and review flags only in the visibility scope, schema, seed and importer', () => {
    const flags = /\b(is_approved|isApproved|is_hidden|isHidden|in_review|inReview)\b/;
    const found = offenders(
      flags,
      (file) =>
        file === 'src/server/visibility.ts' ||
        file.startsWith('src/db/') ||
        file.startsWith('src/server/seed/') ||
        file.startsWith('src/server/importer/'),
    );
    expect(found).toEqual([]);
  });

  it('the visibility scope itself names every flag, so the scan above is not vacuous', () => {
    const code = sources().find(({ file }) => file === 'src/server/visibility.ts')?.code ?? '';
    for (const flag of ['isApproved', 'isHidden', 'inReview']) {
      expect(code).toContain(flag);
    }
  });

  it('calls fetch( only in src/server/importer/source.ts', () => {
    const found = offenders(/(^|[^.\w$])fetch\s*\(|globalThis\.fetch|XMLHttpRequest/, (file) => file === 'src/server/importer/source.ts');
    expect(found).toEqual([]);
  });

  it('imports no HTTP client and no raw socket module anywhere in src', () => {
    const client = /from\s+['"](node:)?(https?|net|tls|http2|undici|axios|got|node-fetch|ky|superagent)['"]/;
    expect(offenders(client, () => false)).toEqual([]);
  });

  it('reads files from disk only in src/server/importer/source.ts and src/db/migrate.ts', () => {
    const fileSystem = /from\s+['"](node:)?fs(\/promises)?['"]/;
    const found = offenders(
      fileSystem,
      (file) => file === 'src/server/importer/source.ts' || file === 'src/db/migrate.ts',
    );
    expect(found).toEqual([]);
  });

  it('imports the database from no page or component (a route handler may)', () => {
    const database = /from\s+['"](@\/db\/|(\.\.\/)+db\/)/;
    const found = sources()
      .filter(({ file }) => file.startsWith('src/app/') || file.startsWith('src/components/'))
      .filter(({ file }) => !/\/route\.(ts|js)$/.test(file))
      .filter(({ code }) => database.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it('divides by 100 only in src/server/money.ts', () => {
    const found = offenders(/\/\s*100\b(?!\s*[*/])/, (file) => file === 'src/server/money.ts');
    expect(found).toEqual([]);
  });

  it('uses no float parsing or fixed-point formatting anywhere in src', () => {
    expect(offenders(/\b(parseFloat|toFixed)\b/, () => false)).toEqual([]);
  });

  it('declares no floating-point or money column in the migrations', () => {
    const sql = walk(path.join(root, 'src/db/migrations'))
      .filter((full) => full.endsWith('.sql'))
      .map((full) => readFileSync(full, 'utf8'))
      .join('\n');
    expect(sql).toContain('CREATE TABLE');
    expect(sql).not.toMatch(/\b(real|double precision|numeric|decimal|money|float\d?)\b/i);
  });
});
