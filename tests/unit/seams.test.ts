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

describe('seams (guardrail 1, S5.1 mapped products)', () => {
  it('names the mapped condition in the visibility scope, so the scan below is not vacuous', () => {
    const code = sources().find(({ file }) => file === 'src/server/visibility.ts')?.code ?? '';
    expect(code).toMatch(/isNotNull\(\s*products\.categoryId\s*\)/);
  });

  it('tests products.category_id for null only in the visibility scope', () => {
    const found = offenders(
      /isNotNull\(\s*products\.categoryId\s*\)|categor(y_id|yId)\s+is\s+not\s+null/i,
      (file) => file === 'src/server/visibility.ts',
    );
    expect(found).toEqual([]);
  });

  it('has the category read go through the shared visibility scope, never its own flag test', () => {
    const code =
      sources().find(({ file }) => file === 'src/server/catalogue/category-page.ts')?.code ?? '';
    expect(code).toContain('visibleProductWhere()');
    expect(code).toContain('visibleOfferWhere()');
  });

  it('updates products only in the importer and the seed', () => {
    const found = offenders(
      /\.update\(\s*products\s*\)/,
      (file) => file.startsWith('src/server/importer/') || file.startsWith('src/server/seed/'),
    );
    expect(found).toEqual([]);
  });
});

describe('seams (guardrail 5, S1.1 click log)', () => {
  it('finds the click modules it scans, so the rules below are not vacuous', () => {
    const files = sources().map(({ file }) => file);
    expect(files).toEqual(
      expect.arrayContaining([
        'src/server/clicks/counting.ts',
        'src/server/clicks/record.ts',
        'src/server/clicks/offer-target.ts',
        'src/app/(public)/go/[offer]/route.ts',
      ]),
    );
    const counting = sources().find(({ file }) => file === 'src/server/clicks/counting.ts');
    expect(counting?.code).toMatch(/user-agent/i);
  });

  it('reads the user agent only in src/server/clicks/counting.ts', () => {
    const found = offenders(/user-agent|userAgent/i, (file) => file === 'src/server/clicks/counting.ts');
    expect(found).toEqual([]);
  });

  it('reads no client address header anywhere in src', () => {
    expect(offenders(/x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip/i, () => false)).toEqual([]);
  });

  it('inserts into clicks only in src/server/clicks/record.ts, and never updates or deletes a click', () => {
    expect(offenders(/\.insert\(\s*clicks\s*\)/, (file) => file === 'src/server/clicks/record.ts')).toEqual([]);
    expect(offenders(/\.(update|delete)\(\s*clicks\s*\)/, () => false)).toEqual([]);
    const record = sources().find(({ file }) => file === 'src/server/clicks/record.ts')?.code ?? '';
    expect(record).toMatch(/\.insert\(\s*clicks\s*\)/);
  });

  it('names the shop URL (offers.url) only under src/db/, the importer and offer-target.ts', () => {
    const found = offenders(
      /\boffers\.url\b/,
      (file) =>
        file.startsWith('src/db/') ||
        file.startsWith('src/server/importer/') ||
        file === 'src/server/clicks/offer-target.ts',
    );
    expect(found).toEqual([]);
    const target = sources().find(({ file }) => file === 'src/server/clicks/offer-target.ts')?.code ?? '';
    expect(target).toMatch(/\boffers\.url\b/);
  });

  it('does not import next/link in the offer list (it prefetches in production)', () => {
    const code = sources().find(({ file }) => file === 'src/components/OfferList.tsx')?.code;
    expect(code).toBeDefined();
    expect(code).not.toMatch(/next\/link/);
  });

  it('mentions no cookie in the /go route or the click modules', () => {
    const found = sources()
      .filter(
        ({ file }) => file.startsWith('src/app/(public)/go/') || file.startsWith('src/server/clicks/'),
      )
      .filter(({ code }) => /cookie/i.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });
});
