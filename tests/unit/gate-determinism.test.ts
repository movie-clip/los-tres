import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { configDefaults } from 'vitest/config';

// Time in tests (decision 0006; runs 2026-11-23-no-clock-in-gate S-1 and
// 2026-11-23-time-in-tests-rule S-2, 02-design § Rule text and § Enforcement).
// The two cost tests (category-fit-cost, sitemap-performance) assert no wall-clock
// time, only a query-count ceiling. Real timings live in tests/timing/ and run only
// by `npm run test:timing`, a separate Vitest config. This file pins:
// - rule 5: the gate cannot pick the timing tests up, by an include, a script, a
//   hook or a workflow, and the separate config still sets up the same database as
//   the integration project;
// - rule 6: nothing retries a test, in either Vitest config, in Playwright, in a
//   test file, in a script or in a workflow;
// - the escape hatch of the ESLint clock rule (tests/unit/eslint-guardrails.test.ts
//   pins the rule itself): the only directive that may switch it off is the
//   next-line form with a `clock:` reason.

type ProjectConfig = {
  resolve?: { alias?: Record<string, string> };
  test?: {
    name?: string;
    include?: string[];
    maxWorkers?: number;
    fileParallelism?: boolean;
    globalSetup?: string[];
    setupFiles?: string[];
    retry?: unknown;
  };
};
type LoadedConfig = { default: { test: { projects: ProjectConfig[]; retry?: unknown } } };

// The configs sit outside tests/ and TypeScript cannot resolve a `.mts` path
// without allowImportingTsExtensions, so they load by a computed specifier.
async function loadConfig(file: string): Promise<LoadedConfig> {
  const href = pathToFileURL(path.resolve(process.cwd(), file)).href;
  return (await import(/* @vite-ignore */ href)) as LoadedConfig;
}

const read = (file: string): string => readFileSync(path.resolve(process.cwd(), file), 'utf8');

/** Every file under `dir` (relative to the repo root) whose name ends in `.ts`, as repo-relative paths. */
function tsFilesUnder(dir: string): string[] {
  const names = readdirSync(path.resolve(process.cwd(), dir), { recursive: true }) as string[];
  return names
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `${dir}/${name.split(path.sep).join('/')}`)
    .sort();
}

// The scripts the gate runs directly, and the lifecycle scripts `npm ci` runs on the
// way in. A script reached from any of them, by a call or by an npm pre or post hook,
// runs inside the gate.
const GATE_SCRIPTS = ['test', 'test:unit', 'test:integration', 'gate', 'gate:ci'];
const GATE_ENTRIES = [...GATE_SCRIPTS, 'preinstall', 'install', 'postinstall', 'prepare'];
const TIMING_TEXT = /test:timing|vitest\.timing|tests\/timing|\.timing\.test/;

/** The script names one script text calls with `npm run <name>`, `npm test`, `npm start` and the like. */
function npmCalls(text: string): string[] {
  const called: string[] = [];
  for (const segment of text.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/);
    const at = words.indexOf('npm');
    if (at < 0) continue;
    const rest = words.slice(at + 1).filter((word) => !word.startsWith('-'));
    const [verb, name] = rest;
    if (verb === 'run' || verb === 'run-script' || verb === 'rum' || verb === 'urn') {
      if (name) called.push(name);
    } else if (verb === 'test' || verb === 'tst' || verb === 't') {
      called.push('test');
    } else if (verb === 'start' || verb === 'stop' || verb === 'restart') {
      called.push(verb);
    }
  }
  return called;
}

/** Every script reachable from `entries`: called by name, or a `pre<name>` or `post<name>` hook of a reached script. */
function scriptsReached(scripts: Record<string, string>, entries: string[]): Set<string> {
  const reached = new Set<string>();
  const visit = (name: string): void => {
    if (reached.has(name)) return;
    reached.add(name);
    for (const hook of [`pre${name}`, `post${name}`]) {
      if (scripts[hook] !== undefined) visit(hook);
    }
    for (const called of npmCalls(scripts[name] ?? '')) visit(called);
  };
  for (const entry of entries) visit(entry);
  return reached;
}

/** The reached scripts that are the timing run or whose text names it. */
function timingRuns(scripts: Record<string, string>, reached: Set<string>): string[] {
  return [...reached].filter((name) => name === 'test:timing' || TIMING_TEXT.test(scripts[name] ?? '')).sort();
}

const TIMING_FILE = 'tests/timing/x.timing.test.ts';

/**
 * True when any include pattern of a project matches a file under tests/timing.
 * A project with no `include` gets Vitest's default include, which matches it.
 */
function includesTimingFile(patterns: string[] | undefined): boolean {
  return (patterns ?? configDefaults.include).some((pattern) => path.posix.matchesGlob(TIMING_FILE, pattern));
}

function projectNamed(config: LoadedConfig, name: string): ProjectConfig {
  const project = config.default.test.projects.find((candidate) => candidate.test?.name === name);
  if (!project) throw new Error(`no project named ${name}`);
  return project;
}

describe('the include check is not vacuous', () => {
  it('matches a broad pattern and the timing pattern, and not the gate patterns', () => {
    expect(includesTimingFile(['tests/**/*.test.ts'])).toBe(true);
    expect(includesTimingFile(['tests/timing/**/*.timing.test.ts'])).toBe(true);
    expect(includesTimingFile(['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'])).toBe(false);
    // No include at all means Vitest's default include, which matches every test file.
    expect(includesTimingFile(undefined)).toBe(true);
    expect(includesTimingFile([])).toBe(false);
  });
});

describe('the gate runs no timing test (rule 5)', () => {
  it('no project of vitest.config.mts includes tests/timing', async () => {
    const { default: config } = await loadConfig('vitest.config.mts');
    const names = config.test.projects.map((project) => project.test?.name);
    expect(names).toEqual(['unit', 'integration']);
    for (const project of config.test.projects) {
      expect(includesTimingFile(project.test?.include), project.test?.name).toBe(false);
    }
  });

  it('the scripts the gate runs name neither test:timing nor the timing config', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const name of GATE_SCRIPTS) {
      expect(scripts[name], name).toBeDefined();
      expect(scripts[name], name).not.toContain('test:timing');
      expect(scripts[name], name).not.toContain('vitest.timing');
    }
  });

  it('no script the gate reaches, through a call, a pre or post hook or an install step, runs the timing tests', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const reached = scriptsReached(scripts, GATE_ENTRIES);
    // The walk follows the real scripts: the gate's own steps are in it.
    for (const step of ['lint', 'typecheck', 'db:up', 'stack:up', 'test', 'test:e2e', 'test:e2e:ci']) {
      expect(reached.has(step), step).toBe(true);
    }
    expect(timingRuns(scripts, reached)).toEqual([]);
  });

  it('the required CI workflow does not run the timing tests', () => {
    expect(read('.github/workflows/gate.yml')).not.toMatch(/test:timing|vitest\.timing/);
  });
});

describe('npm run test:timing', () => {
  it('runs the timing config and nothing else', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(scripts['test:timing']).toBe('vitest run --config vitest.timing.config.mts');
  });

  it('includes only tests/timing, one worker, one file at a time', async () => {
    const config = await loadConfig('vitest.timing.config.mts');
    expect(config.default.test.projects).toHaveLength(1);
    const { test } = projectNamed(config, 'timing');
    expect(test?.include).toEqual(['tests/timing/**/*.timing.test.ts']);
    expect(includesTimingFile(test?.include)).toBe(true);
    expect(test?.maxWorkers).toBe(1);
    expect(test?.fileParallelism).toBe(false);
  });

  it('sets up the database the way the integration project does', async () => {
    const gate = projectNamed(await loadConfig('vitest.config.mts'), 'integration');
    const timing = projectNamed(await loadConfig('vitest.timing.config.mts'), 'timing');
    expect(timing.test?.globalSetup).toEqual(gate.test?.globalSetup);
    expect(timing.test?.setupFiles).toEqual(gate.test?.setupFiles);
    expect(timing.resolve?.alias).toEqual(gate.resolve?.alias);
    // Not empty on both sides, or the equalities above prove nothing.
    expect(timing.test?.globalSetup?.length).toBeGreaterThan(0);
    expect(timing.test?.setupFiles?.length).toBeGreaterThan(0);
    expect(Object.keys(timing.resolve?.alias ?? {}).length).toBeGreaterThan(0);
  });
});

describe('the script check is not vacuous', () => {
  const timing = 'vitest run --config vitest.timing.config.mts';
  const clean: Record<string, string> = {
    lint: 'eslint .',
    test: 'vitest run',
    'test:unit': 'vitest run --project unit',
    'test:e2e': 'playwright test',
    gate: 'npm run lint && npm test && npm run test:e2e',
    'test:timing': timing,
  };
  const offending: [string, Record<string, string>][] = [
    ['a direct call in the gate', { ...clean, gate: `${clean.gate} && npm run test:timing` }],
    ['a pre hook of test', { ...clean, pretest: 'npm run test:timing' }],
    ['a post hook of test', { ...clean, posttest: 'npm run test:timing' }],
    ['a post hook of the gate', { ...clean, postgate: 'npm run test:timing' }],
    ['a script another gate script calls', { ...clean, lint: 'npm run check', check: 'npm run test:timing' }],
    ['a hook of a script another gate script calls', { ...clean, lint: 'npm run check', precheck: 'npm run test:timing' }],
    ['the timing config written into a step', { ...clean, lint: `eslint . && ${timing}` }],
    ['npm with a flag before run', { ...clean, gate: 'npm --silent run check', check: 'npm run test:timing' }],
    ['an install step', { ...clean, postinstall: 'npm run test:timing' }],
  ];

  it.each(offending)('finds the timing run in %s', (_name, scripts) => {
    expect(timingRuns(scripts, scriptsReached(scripts, GATE_ENTRIES))).not.toEqual([]);
  });

  it('finds nothing in scripts that never reach it, even when test:timing exists', () => {
    expect(timingRuns(clean, scriptsReached(clean, GATE_ENTRIES))).toEqual([]);
    const unreached = { ...clean, check: 'npm run test:timing', pretiming: 'npm run lint' };
    expect(timingRuns(unreached, scriptsReached(unreached, GATE_ENTRIES))).toEqual([]);
  });
});

/** A comment of a TypeScript source: its text without the delimiters, and its 1-based line. */
type SourceComment = { text: string; line: number };

/**
 * Every real comment of a source. The parser tells a comment from the text of a
 * string or a regex, so a sample directive inside a string is not a directive, which
 * is also what ESLint reads.
 */
function commentsOf(source: string): SourceComment[] {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const seen = new Set<number>();
  const found: SourceComment[] = [];
  const take = (ranges: ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const raw = source.slice(range.pos, range.end);
      const block = range.kind === ts.SyntaxKind.MultiLineCommentTrivia;
      found.push({
        text: block ? raw.slice(2, -2) : raw.slice(2),
        line: file.getLineAndCharacterOfPosition(range.pos).line + 1,
      });
    }
  };
  const visit = (node: ts.Node): void => {
    take(ts.getLeadingCommentRanges(source, node.getFullStart()));
    take(ts.getTrailingCommentRanges(source, node.getEnd()));
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return found;
}

// The one directive that may switch the clock rule off (0006, rule 2): the next-line
// form, for that rule alone, with `clock:` and a reason of at least ten characters.
const CLOCK_DIRECTIVE = /^eslint-disable-next-line no-restricted-syntax -- clock: \S[\s\S]{8,}\S$/;

/**
 * The comments that could switch off `no-restricted-syntax`, the clock rule, without
 * being the one allowed directive: a directive naming the rule in any other form, a
 * directive naming no rule (it covers all of them), a file-level `eslint-disable`, and
 * an inline `eslint no-restricted-syntax: off` configuration comment.
 */
function clockDirectiveOffenders(source: string): SourceComment[] {
  return commentsOf(source).filter((comment) => {
    const text = comment.text.trim();
    const directive = /^eslint-disable(?:-next-line|-line)?(?![\w-])([\s\S]*)$/.exec(text);
    if (directive) {
      const names = directive[1]
        .split(/\s-{2,}\s/)[0]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      const coversTheRule = names.length === 0 || names.includes('no-restricted-syntax');
      return coversTheRule && !CLOCK_DIRECTIVE.test(text);
    }
    return /^eslint\s/.test(text) && text.includes('no-restricted-syntax');
  });
}

const CLOCK_RULE_DIRS = ['tests/unit', 'tests/integration', 'tests/support'];

describe('the directive guard is not vacuous', () => {
  const comment = (text: string): string => `${text}\nexport const x = 1;\n`;

  it.each([
    ['no reason', '// eslint-disable-next-line no-restricted-syntax'],
    ['a reason that is not a clock reason', '// eslint-disable-next-line no-restricted-syntax -- a stored time'],
    ['a clock reason under ten characters', '// eslint-disable-next-line no-restricted-syntax -- clock: short'],
    ['the same-line form', '// eslint-disable-line no-restricted-syntax -- clock: a reason long enough to count'],
    ['a file-level directive', '/* eslint-disable no-restricted-syntax */'],
    ['a file-level directive with a clock reason', '/* eslint-disable no-restricted-syntax -- clock: a reason long enough to count */'],
    ['a directive naming no rule, which covers every rule', '/* eslint-disable */'],
    ['a next-line directive naming no rule', '// eslint-disable-next-line'],
    ['a rule list', '// eslint-disable-next-line no-console, no-restricted-syntax -- clock: a reason long enough to count'],
    ['an inline configuration that turns the rule off', '/* eslint no-restricted-syntax: off */'],
    ['an inline configuration with an array', '/* eslint no-restricted-syntax: ["off"] */'],
  ])('flags %s', (_name, text) => {
    expect(clockDirectiveOffenders(comment(text))).toHaveLength(1);
  });

  it.each([
    ['the allowed directive', '// eslint-disable-next-line no-restricted-syntax -- clock: a stored time is checked within a minute'],
    ['a directive for another rule', '// eslint-disable-next-line react/no-children-prop'],
    ['an enable comment', '/* eslint-enable no-restricted-syntax */'],
    ['a plain comment that names the rule', '// no-restricted-syntax is the clock rule'],
  ])('lets %s through', (_name, text) => {
    expect(clockDirectiveOffenders(comment(text))).toEqual([]);
  });

  it('reads comments, not text: a directive inside a string or a template is not one', () => {
    const source = [
      "export const a = '// eslint-disable-next-line no-restricted-syntax';",
      'export const b = `/* eslint-disable */`;',
      '',
    ].join('\n');
    expect(commentsOf(source)).toEqual([]);
    expect(clockDirectiveOffenders(source)).toEqual([]);
  });

  it('finds a directive that sits before a closing brace or inside an expression', () => {
    const source = ['function f() {', '  return g(', '    // eslint-disable-next-line no-restricted-syntax', '    1,', '  );', '  // eslint-disable', '}', ''].join('\n');
    expect(clockDirectiveOffenders(source).map((offender) => offender.line)).toEqual([3, 6]);
  });
});

// Parsing every test file takes about a second (0006, rule 4: a hang guard over ten times that).
const SCAN_TIMEOUT = 30_000;

describe('the clock rule has one escape hatch (0006, rule 2)', () => {
  it('every directive in a unit, integration or support file that could switch the rule off is the next-line form with a clock reason', () => {
    const files = CLOCK_RULE_DIRS.flatMap(tsFilesUnder);
    // The scan sees the files, or an empty list would pass.
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) =>
      clockDirectiveOffenders(read(file)).map((offender) => `${file}:${offender.line}: ${offender.text.trim()}`),
    );
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT);

  it('the scan finds the directives the tests carry today', () => {
    const allowed = CLOCK_RULE_DIRS.flatMap(tsFilesUnder).flatMap((file) =>
      commentsOf(read(file)).filter((comment) => CLOCK_DIRECTIVE.test(comment.text.trim())),
    );
    expect(allowed.length).toBeGreaterThan(0);
  }, SCAN_TIMEOUT);
});

/** The values of every `retries:` entry of a Playwright config that are not `0`. */
function retriesAboveZero(text: string): string[] {
  return [...text.matchAll(/\bretries\s*:\s*([^,}\n]+)/g)].map((match) => match[1].trim()).filter((value) => value !== '0');
}

/** The lines of a workflow, comments left out, that retry a step or a job or let a failure pass. */
function retryLines(workflow: string): string[] {
  return workflow
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .filter((line) => /retr(?:y|ies)|\bre-?run\b|continue-on-error/i.test(line));
}

/** The places in a test source that ask for a retry: an option, a configure call, a setter. */
function retryOptions(source: string): string[] {
  return [...source.matchAll(/\bretr(?:y|ies)\s*:|\.retry\s*\(|\bsetRetries\b|\bretries\s*=/g)].map((match) => match[0]);
}

describe('no automatic retries (rule 6)', () => {
  it('neither Vitest config sets retry, at the top, in a project or anywhere in its text', async () => {
    for (const file of ['vitest.config.mts', 'vitest.timing.config.mts']) {
      const { default: config } = await loadConfig(file);
      expect(config.test.retry, file).toBeUndefined();
      for (const project of config.test.projects) expect(project.test?.retry, `${file} ${project.test?.name}`).toBeUndefined();
      expect(read(file), file).not.toMatch(/\bretry\b/);
    }
  });

  it('playwright.config.ts sets no retries above 0', () => {
    expect(retriesAboveZero(read('playwright.config.ts'))).toEqual([]);
  });

  it('no script passes a retry flag to a runner', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const [name, text] of Object.entries(scripts)) expect(text, name).not.toMatch(/--retr(?:y|ies)\b/);
  });

  it('no workflow retries a step or a job, or lets a failure pass', () => {
    const dir = path.resolve(process.cwd(), '.github/workflows');
    const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
    expect(files).toContain('gate.yml');
    for (const file of files) expect(retryLines(readFileSync(path.join(dir, file), 'utf8')), file).toEqual([]);
  });

  it('no test file asks for a retry, with an option, configure(), a setter or an assignment', () => {
    const self = 'tests/unit/gate-determinism.test.ts';
    const files = ['tests/unit', 'tests/integration', 'tests/support', 'tests/e2e', 'tests/timing']
      .filter((dir) => existsSync(path.resolve(process.cwd(), dir)))
      .flatMap(tsFilesUnder)
      .filter((file) => file !== self);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) => retryOptions(read(file)).map((match) => `${file}: ${match}`));
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT);

  it('the checks above can fail', () => {
    expect(retriesAboveZero('export default defineConfig({ retries: 2, use: {} });')).toEqual(['2']);
    expect(retriesAboveZero('export default defineConfig({ retries: process.env.CI ? 2 : 0 });')).toEqual(['process.env.CI ? 2 : 0']);
    expect(retriesAboveZero('export default defineConfig({ retries: 0 });')).toEqual([]);
    expect(retriesAboveZero('export default defineConfig({ workers: 1 });')).toEqual([]);
    expect(retryLines('steps:\n  - uses: nick-fields/retry@v3\n')).toHaveLength(1);
    expect(retryLines('steps:\n  - run: npm test\n    continue-on-error: true\n')).toHaveLength(1);
    expect(retryLines('steps:\n  - run: gh run rerun --failed\n')).toHaveLength(1);
    expect(retryLines('# no retries here\nsteps:\n  - run: npm test\n')).toEqual([]);
    expect(retryOptions("test.describe.configure({ retries: 2 });")).toHaveLength(1);
    expect(retryOptions("describe('x', { retry: 3 }, () => {});")).toHaveLength(1);
    expect(retryOptions("vi.setConfig({ retry: 1 }); test.retry(2);")).toHaveLength(2);
    expect(retryOptions("it('works', () => { expect(retried).toBe(1); });")).toEqual([]);
  });
});
