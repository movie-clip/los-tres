import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// AC 27, D-8: the admin screens hold no user-facing string of their own. Visible
// text comes from the Admin namespace of messages/es-ES.json. A text scan, so it
// needs neither a build nor a browser; the e2e checks the rendered copy.

const root = process.cwd();
const ADMIN_DIRS = ['src/app/admin', 'src/components/admin'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** The admin component and page files, with comments removed. */
function adminSources(): { file: string; code: string }[] {
  return ADMIN_DIRS.flatMap((dir) => walk(path.join(root, dir)))
    .filter((full) => /\.tsx$/.test(full))
    .map((full) => ({
      file: path.relative(root, full).split(path.sep).join('/'),
      code: readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
        .join('\n'),
    }));
}

const LETTERS = /[A-Za-zÁÉÍÓÚÜáéíóúüñÑ]{2,}/;

describe('the admin screens use no inline strings (AC 27)', () => {
  it('finds the admin files it scans, so the rules below are not vacuous', () => {
    const files = adminSources().map(({ file }) => file);
    expect(files).toEqual(
      expect.arrayContaining([
        'src/app/admin/acceso/page.tsx',
        'src/app/admin/acceso/SignInForm.tsx',
        'src/app/admin/(shell)/page.tsx',
        'src/components/admin/AdminHeader.tsx',
      ]),
    );
  });

  it('has no words between JSX tags', () => {
    const found = adminSources().flatMap(({ file, code }) =>
      [...code.matchAll(/<\/?[A-Za-z][\w.]*(?:\s[^<>]*)?>([^<>{}]+)</g)]
        .map((match) => match[1].trim())
        // Type arguments such as Promise<Record<...>> are not JSX.
        .filter((text) => LETTERS.test(text) && !/[;=)(]|=>|\bextends\b/.test(text))
        .map((text) => `${file}: ${text}`),
    );
    expect(found).toEqual([]);
  });

  it('has no literal text in the attributes a screen reader or browser shows', () => {
    const attribute = /\b(aria-label|aria-description|title|alt|placeholder|label|heading|body|message|text)=("([^"{}]*)"|'([^'{}]*)')/g;
    const found = adminSources().flatMap(({ file, code }) =>
      [...code.matchAll(attribute)]
        .filter((match) => LETTERS.test(match[3] ?? match[4] ?? ''))
        .map((match) => `${file}: ${match[0]}`),
    );
    expect(found).toEqual([]);
  });

  it('has no quoted Spanish sentence or accented word outside a message call', () => {
    const found = adminSources().flatMap(({ file, code }) =>
      [...code.matchAll(/(["'`])([^"'`\n]*[áéíóúñÁÉÍÓÚÑ¿¡][^"'`\n]*)\1/g)].map((match) => `${file}: ${match[2]}`),
    );
    expect(found).toEqual([]);
  });

  it('reads every visible string through next-intl, never from a local constant table', () => {
    const found = adminSources()
      .filter(({ file }) => /\/page\.tsx$|layout\.tsx$/.test(file))
      .filter(({ code }) => /return\s*\(?\s*</.test(code) && !/getTranslations/.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });
});

describe('the page language (AC 27)', () => {
  it('declares Spanish on the root element every admin page shares', () => {
    const layout = readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    expect(layout).toMatch(/<html[^>]*\blang=/);
    const request = readFileSync(path.join(root, 'src/i18n/request.ts'), 'utf8');
    expect(request).toMatch(/es-ES/);
  });

  it('renders no public header or footer on an admin page (the root layout is bare)', () => {
    const layout = readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/SiteHeader|SiteFooter|PublicChrome/);
    for (const { file, code } of adminSources()) {
      expect(code, file).not.toMatch(/SiteHeader|SiteFooter|PublicChrome/);
    }
  });
});
