import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// S12.2 (decision 0017, guardrail 2), ACs 44 and 45: two guards that fail when the repository starts to
// depend on the owner's collector or on a scraping or HTML-parsing package. The collector is a separate tool
// in a separate private repository: nothing under src/ or scripts/ may import it, and the app's package.json
// may hold no scraping dependency and no dependency that points at a path, a link or a git address. Each guard
// is shown to fail on a planted offender (in memory: no file with a planted import is ever written) and to be
// clean on the real tree. The scraping list is the lint ban's own (eslint.config.mjs, via the real config,
// not a second list: DS-14). AC 46 (the lint ban, its test and the seams rules unchanged) is the existing
// eslint-guardrails.test.ts and seams.test.ts, which this file does not touch.

const ROOT = process.cwd();
const TIMEOUT = 60_000;

// ---------- AC 44: nothing under src/ or scripts/ imports the collector ----------

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

type Source = { file: string; content: string };

function sourceFiles(dir: string): Source[] {
  const found: Source[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(path.join(ROOT, current), { withFileTypes: true })) {
      const next = path.posix.join(current, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (SOURCE_FILE.test(entry.name)) found.push({ file: next, content: readFileSync(path.join(ROOT, next), 'utf8') });
    }
  };
  walk(dir);
  return found;
}

/** Every module specifier a file names: static, side-effect, re-export, dynamic and require forms, comments left out. */
function specifiersOf(content: string): string[] {
  const code = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');
  return [...code.matchAll(/\b(?:from|import|require)\s*\(?\s*(['"`])([^'"`\n]+)\1/g)].map((match) => match[2]);
}

/** A specifier is an offender when it names a collector, or leaves the repository tree by a path. */
function collectorOffenders(files: Source[]): string[] {
  const offenders: string[] = [];
  for (const { file, content } of files) {
    for (const specifier of specifiersOf(content)) {
      const named = /collector/i.test(specifier);
      const absolute = /^(?:[A-Za-z]:[\\/]|[\\/]|file:)/.test(specifier);
      const outside =
        absolute ||
        (specifier.startsWith('.') && path.relative(ROOT, path.resolve(ROOT, path.dirname(file), specifier)).split(/[\\/]/)[0] === '..');
      if (named || outside) offenders.push(`${file}: ${specifier}`);
    }
  }
  return offenders.sort();
}

describe('nothing under src/ or scripts/ imports the collector (AC 44)', () => {
  const real = [...sourceFiles('src'), ...sourceFiles('scripts')];

  it('is clean on the real tree, over a tree it has actually read (non-vacuity)', () => {
    expect(real.length).toBeGreaterThan(150);
    expect(real.map((source) => source.file)).toEqual(
      expect.arrayContaining(['src/server/visibility.ts', 'src/instrumentation.ts', 'scripts/init-env.mjs']),
    );
    expect(real.flatMap((source) => specifiersOf(source.content)).length).toBeGreaterThan(300);
    expect(collectorOffenders(real)).toEqual([]);
  });

  it.each([
    ['a package named for the collector', "import { run } from 'los-tres-collector';\nexport { run };\n"],
    ['a scoped package with the word in it', "import { run } from '@owner/price-Collector-kit';\nexport { run };\n"],
    ['a module path with the word in it', "import { run } from './lib/collector-bridge';\nexport { run };\n"],
    ['a relative path that leaves the repository', "import { run } from '../../../los-tres-privado/run';\nexport { run };\n"],
    ['a relative path that leaves the repository from a deep file', "import { run } from '../../../../otro/run';\nexport { run };\n"],
    ['an absolute posix path', "import { run } from '/home/owner/tool/run.js';\nexport { run };\n"],
    ['a windows drive path', "import { run } from 'C:\\\\Users\\\\owner\\\\tool\\\\run.js';\nexport { run };\n"],
    ['a file: address', "import { run } from 'file:///home/owner/tool/run.js';\nexport { run };\n"],
    ['a side-effect import', "import 'los-tres-collector/register';\n"],
    ['a re-export', "export * from 'los-tres-collector';\n"],
    ['a dynamic import', "export const load = () => import('los-tres-collector');\n"],
    ['a require call', "const run = require('los-tres-collector');\nmodule.exports = run;\n"],
  ])('fails on %s', (_label, content) => {
    const planted: Source[] = [{ file: 'src/server/planted.ts', content }];
    expect(collectorOffenders(planted)).toHaveLength(1);
    // The same file in scripts/ is caught too.
    expect(collectorOffenders([{ file: 'scripts/planted.mjs', content }])).toHaveLength(1);
  });

  it('does not fail on ordinary imports: a package, a node module, the alias, a relative path inside the tree', () => {
    const content = [
      "import { sql } from 'drizzle-orm';",
      "import { readFile } from 'node:fs/promises';",
      "import { getDb } from '@/db/client';",
      "import { one } from './one';",
      "import { two } from '../server/two';",
      "// import { fake } from 'los-tres-collector';",
      "/* import { fake } from '../../outside'; */",
      "export const note = 'the collected folder';",
    ].join('\n');
    expect(collectorOffenders([{ file: 'src/server/ordinary.ts', content }])).toEqual([]);
  });
});

// ---------- AC 45: no scraping or HTML-parsing package, no non-registry dependency ----------

type PackageFile = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
const eslint = new ESLint({ cwd: ROOT });

/** The names the repository's own lint ban (guardrail 2) flags when imported in src/server: no second list. */
async function scrapingNames(names: string[]): Promise<Set<string>> {
  const code = names.map((name) => `import x from '${name}';`).join('\n') + '\n';
  const [result] = await eslint.lintText(code, { filePath: path.resolve(ROOT, 'src/server/virtual-dependency-check.ts') });
  const flagged = new Set<string>();
  for (const message of result.messages) {
    if (message.ruleId === 'no-restricted-imports' && message.message.includes('Guardrail 2')) flagged.add(names[message.line - 1]);
  }
  return flagged;
}

/** A version spec that is not a registry version or range: a path, a file, a link, a git address, a tarball URL. */
function isNonRegistry(spec: string): boolean {
  const value = spec.trim();
  if (/^npm:/.test(value)) return false;
  if (/^(?:file|link|portal|workspace|git|git\+[a-z]+|github|gitlab|bitbucket|gist|http|https|ssh):/i.test(value)) return true;
  if (/^(?:git@|\.{1,2}[\\/]|~[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(value)) return true;
  // GitHub shorthand: owner/repo with an optional #ref.
  return /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(value);
}

async function dependencyOffenders(pkg: PackageFile): Promise<string[]> {
  const names = SECTIONS.flatMap((section) => Object.keys(pkg[section] ?? {}));
  const scraping = await scrapingNames([...new Set(names)]);
  const offenders: string[] = [];
  for (const section of SECTIONS) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      // The one exception: the Playwright test runner, in devDependencies only.
      const runner = name === '@playwright/test' && section === 'devDependencies';
      if (scraping.has(name) && !runner) offenders.push(`${section}: ${name} (scraping or HTML parsing)`);
      if (isNonRegistry(spec)) offenders.push(`${section}: ${name} (not a registry version)`);
    }
  }
  return offenders.sort();
}

describe('the dependency list holds no scraping package and no non-registry dependency (AC 45)', () => {
  it('is clean on the real package.json, over a list it has actually read (non-vacuity)', async () => {
    const real = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageFile;

    expect(Object.keys(real.dependencies ?? {})).toEqual(expect.arrayContaining(['next', 'drizzle-orm', 'sax']));
    expect(Object.keys(real.devDependencies ?? {})).toContain('@playwright/test');
    expect(await dependencyOffenders(real)).toEqual([]);
  }, TIMEOUT);

  it.each([
    ['cheerio', 'dependencies'],
    ['jsdom', 'devDependencies'],
    ['linkedom', 'dependencies'],
    ['parse5', 'optionalDependencies'],
    ['node-html-parser', 'dependencies'],
    ['htmlparser2', 'dependencies'],
    ['puppeteer', 'devDependencies'],
    ['puppeteer-core', 'dependencies'],
    ['playwright', 'devDependencies'],
    ['playwright-core', 'dependencies'],
    ['@playwright/browser-chromium', 'devDependencies'],
    ['@playwright/test', 'dependencies'],
    ['@playwright/test', 'optionalDependencies'],
  ] as const)('fails on %s in %s', async (name, section) => {
    const planted: PackageFile = { dependencies: { next: '^16.0.0' }, [section]: { [name]: '^1.0.0' } };

    expect(await dependencyOffenders(planted)).toEqual([`${section}: ${name} (scraping or HTML parsing)`]);
  }, TIMEOUT);

  it('allows the Playwright test runner in devDependencies only', async () => {
    expect(await dependencyOffenders({ devDependencies: { '@playwright/test': '^1.64.1' } })).toEqual([]);
  }, TIMEOUT);

  it.each([
    ['a file: path', 'file:../herramienta'],
    ['a link: path', 'link:../herramienta'],
    ['a relative path', '../herramienta'],
    ['an absolute path', '/opt/herramienta'],
    ['a home path', '~/herramienta'],
    ['a drive path', 'C:\\herramienta'],
    ['a git+https address', 'git+https://example.test/owner/herramienta.git'],
    ['a git+ssh address', 'git+ssh://git@example.test/owner/herramienta.git'],
    ['a git: address', 'git://example.test/owner/herramienta.git'],
    ['a github: address', 'github:owner/herramienta'],
    ['a GitHub shorthand', 'owner/herramienta#main'],
    ['a tarball URL', 'https://example.test/herramienta-1.0.0.tgz'],
    ['a workspace: address', 'workspace:*'],
  ])('fails on %s', async (_label, spec) => {
    for (const section of SECTIONS) {
      expect(await dependencyOffenders({ [section]: { 'herramienta-propia': spec } }), section).toEqual([
        `${section}: herramienta-propia (not a registry version)`,
      ]);
    }
  }, TIMEOUT);

  it.each(['1.6.1', '^16.4.6', '~1.2.3', '>=1 <2', 'latest', '*', 'npm:otro-paquete@^1.0.0'])('accepts the registry version %s', async (spec) => {
    expect(await dependencyOffenders({ dependencies: { 'un-paquete': spec } })).toEqual([]);
  }, TIMEOUT);
});
