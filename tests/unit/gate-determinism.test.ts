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
//   hook or the required workflow, and the separate config still sets up the same
//   database as the integration project; the one workflow job that runs them is the
//   `timing` job of gate-repeat.yml, which is manual and report-only (run
//   2026-11-23-gate-repeat-workflow, issue #349, pinned at the end of this file);
// - rule 6: nothing retries a test, in either Vitest config, in Playwright, in a
//   test file, in a script or in any workflow;
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

/** A comment of a TypeScript source: its text without the delimiters, its 1-based line, and whether it is a block comment. */
type SourceComment = { text: string; line: number; block: boolean };

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
        block,
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

// The one directive that may switch the clock rule off (0006, rule 2): a line comment,
// `// eslint-disable-next-line no-restricted-syntax -- clock: <reason>`, for that rule
// alone, with a reason of at least ten characters. ESLint also honours the block form
// `/* eslint-disable-next-line ... */`; the rule does not give it, so it is refused.
const CLOCK_DIRECTIVE = /^eslint-disable-next-line no-restricted-syntax -- clock: \S[\s\S]{8,}\S$/;

function isClockDirective(comment: SourceComment): boolean {
  return !comment.block && CLOCK_DIRECTIVE.test(comment.text.trim());
}

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
      return coversTheRule && !isClockDirective(comment);
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
    ['the next-line form as a block comment', '/* eslint-disable-next-line no-restricted-syntax -- clock: a reason long enough to count */'],
    ['the next-line form as a block comment on its own lines', '/*\n eslint-disable-next-line no-restricted-syntax -- clock: a reason long enough to count\n */'],
    ['a rule list','// eslint-disable-next-line no-console, no-restricted-syntax -- clock: a reason long enough to count'],
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
      commentsOf(read(file)).filter(isClockDirective),
    );
    expect(allowed.length).toBeGreaterThan(0);
  }, SCAN_TIMEOUT);
});

/** The values of every `retries:` entry of a Playwright config that are not `0`. */
function retriesAboveZero(text: string): string[] {
  return [...text.matchAll(/\bretries\s*:\s*([^,}\n]+)/g)].map((match) => match[1].trim()).filter((value) => value !== '0');
}

/**
 * The lines of a workflow, comments left out, that retry a step or a job or set
 * `continue-on-error`. A shell `||` that swallows a command is a different check, made
 * below (`swallowingLines`), because one job is allowed it.
 */
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

  it('no workflow retries a step or a job, or sets continue-on-error', () => {
    const dir = path.resolve(process.cwd(), '.github/workflows');
    const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
    expect(files).toEqual(expect.arrayContaining(['gate.yml', 'gate-repeat.yml']));
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

// The manual workflow gate-repeat.yml (run 2026-11-23-gate-repeat-workflow, issue #349;
// design: run 2026-11-23-no-clock-in-gate, 02-design § CI repetition, choice L15). The
// workflows are read as text, line by line, with no YAML parser (js-yaml is only a
// transitive dependency): a job is the block two spaces in under `jobs:`, a job setting
// the block four spaces in, a step a list item under `steps:`. Comment lines are left out.
// What text cannot see (an expression, an anchor, a script that swallows a failure with
// no `||`) is named in the run report, not here.

const GATE_FILE = 'gate.yml';
const REPEAT_FILE = 'gate-repeat.yml';
/** The one job that may swallow a failing command: it measures and reports, it does not gate. */
const TIMING_JOB = `${REPEAT_FILE}#timing`;

const workflowFiles = (): string[] =>
  readdirSync(path.resolve(process.cwd(), '.github/workflows'))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
const workflowText = (file: string): string => read(`.github/workflows/${file}`);

/** The lines of a workflow that are not blank and not comments, trailing space removed. */
function codeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const unquote = (value: string): string => value.trim().replace(/^(["'])(.*)\1$/, '$2');

type Block = { key: string; inline: string; body: string[] };

/** The `key:` entries exactly `indent` spaces in, each with its inline value and the lines below it. */
function blocksAt(lines: string[], indent: number): Block[] {
  const entry = new RegExp(`^ {${indent}}(?! )["']?([\\w.-]+)["']?\\s*:(?:\\s+(.*))?$`);
  const blocks: Block[] = [];
  for (const line of lines) {
    const match = entry.exec(line);
    if (match) blocks.push({ key: match[1], inline: (match[2] ?? '').trim(), body: [] });
    else blocks.at(-1)?.body.push(line);
  }
  return blocks;
}

type Job = { id: string; body: string[]; keys: Block[] };

function jobsOf(workflow: string): Job[] {
  const jobs = blocksAt(codeLines(workflow), 0).find((block) => block.key === 'jobs');
  if (!jobs) throw new Error('the workflow has no jobs: block');
  return blocksAt(jobs.body, 2).map((job) => ({ id: job.key, body: job.body, keys: blocksAt(job.body, 4) }));
}

function jobNamed(workflow: string, id: string): Job {
  const job = jobsOf(workflow).find((candidate) => candidate.id === id);
  if (!job) throw new Error(`no job named ${id}`);
  return job;
}

/** The name GitHub shows for the job's check: its `name:`, or its id when it has none. */
function checkNameOf(job: Job): string {
  return unquote(job.keys.find((key) => key.key === 'name')?.inline ?? '') || job.id;
}

/** The events that start a workflow, from any of the forms `on:` takes: a scalar, a flow list, a block list, a map. */
function triggersOf(workflow: string): string[] {
  const on = blocksAt(codeLines(workflow), 0).find((block) => block.key === 'on');
  if (!on) throw new Error('the workflow has no on: block');
  if (on.inline) {
    const flow = /^\[(.*)\]$/.exec(on.inline);
    return (flow ? flow[1].split(',') : [on.inline]).map(unquote).filter(Boolean);
  }
  const base = Math.min(...on.body.map(indentOf));
  return on.body
    .filter((line) => indentOf(line) === base)
    .map((line) => /^\s*(?:-\s+)?["']?([\w-]+)["']?\s*(?::|$)/.exec(line)?.[1] ?? line.trim());
}

/** The steps of a job, each as its lines with the list indent taken off. */
function stepsOf(job: Job): string[][] {
  const lines = job.keys.find((key) => key.key === 'steps')?.body ?? [];
  if (lines.length === 0) throw new Error(`job ${job.id} has no steps`);
  const itemIndent = indentOf(lines[0]);
  const steps: string[][] = [];
  for (const line of lines) {
    if (indentOf(line) === itemIndent && line.trimStart().startsWith('- ')) steps.push([]);
    steps.at(-1)?.push(line.slice(itemIndent));
  }
  return steps;
}

// The one way a copy's steps may differ from the gate job's: its checkout takes the
// commit `plan` resolved, so the `pr` input tests that pull request's merge commit.
const COPY_REF_LINES = ['with:', 'ref: ${{ needs.plan.outputs.ref }}'];

/** The copy job's steps with the allowed difference taken out of the checkout step; `removed` counts where it was. */
function withoutCopyRef(steps: string[][]): { steps: string[][]; removed: number } {
  let removed = 0;
  const kept = steps.map((step) => {
    const rest = step.slice(1);
    const isCheckout = /^- uses: actions\/checkout@/.test(step[0]);
    if (isCheckout && rest.length === COPY_REF_LINES.length && rest.every((line, at) => line.trim() === COPY_REF_LINES[at])) {
      removed += 1;
      return step.slice(0, 1);
    }
    return step;
  });
  return { steps: kept, removed };
}

// What a job is, apart from the steps and apart from who it is: a copy and the gate job
// must agree on the runner, the timeout and anything else set on the job.
const JOB_IDENTITY_KEYS = ['name', 'needs', 'strategy'];

function jobSettings(job: Job): Record<string, string[]> {
  return Object.fromEntries(
    job.keys
      .filter((key) => key.key !== 'steps' && !JOB_IDENTITY_KEYS.includes(key.key))
      .map((key) => [key.key, [key.inline, ...key.body]]),
  );
}

const timeoutOf = (job: Job): number => Number(job.keys.find((key) => key.key === 'timeout-minutes')?.inline);

// The ways a workflow line lets a failing command pass: a shell `||`, `continue-on-error`,
// `set +e`, a trailing `; true`, `; :` or `; exit 0`, a bare `exit 0`, and a custom
// `shell:` with `{0}`, which drops the default `-e`. A `||` inside `${{ }}` is an
// expression, not a shell, and is not one.
const SWALLOWS = [/\|\|/, /continue-on-error/i, /\bset\s+\+e\b/, /;\s*(?:true|:|exit\s+0)\s*$/, /^\s*exit\s+0\b/, /\bshell\s*:.*\{0\}/];

function swallowingLines(lines: string[]): string[] {
  return lines
    .filter((line) => {
      const shell = line.replace(/\$\{\{.*?\}\}/g, '');
      return SWALLOWS.some((pattern) => pattern.test(shell));
    })
    .map((line) => line.trim());
}

// The swallowing lines allowed outside the timing job, by `file#job`. `plan` reads the
// pull request's merge ref with `git ls-remote`; a failing call leaves `sha` empty, and
// the next line fails the job on anything that is not a 40-hex commit.
const SWALLOW_ALLOWED: Record<string, string[]> = {
  [`${REPEAT_FILE}#plan`]: [
    `sha="$(git ls-remote "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" "refs/pull/$PR/merge" | cut -f1)" || sha=''`,
  ],
};

describe('the copy job runs what the gate job runs', () => {
  const gate = (): Job => jobNamed(workflowText(GATE_FILE), 'gate');
  const copy = (): Job => jobNamed(workflowText(REPEAT_FILE), 'copy');

  it('its steps are the gate job steps, step by step, but for the ref its checkout takes', () => {
    const expected = stepsOf(gate());
    const { steps, removed } = withoutCopyRef(stepsOf(copy()));
    expect(steps).toEqual(expected);
    // The allowed difference is there, once: without it `pr` would test the dispatched ref.
    expect(removed).toBe(1);
    // The comparison holds the steps the gate is made of, or an empty pair would pass.
    expect(expected.length).toBeGreaterThan(5);
    expect(expected.flat().join('\n')).toContain('npm run gate:ci');
  });

  it('its runner, timeout and every other job setting equal the gate job, apart from name, needs and strategy', () => {
    const settings = jobSettings(gate());
    expect(Object.keys(settings)).toEqual(expect.arrayContaining(['runs-on', 'timeout-minutes']));
    expect(jobSettings(copy())).toEqual(settings);
  });

  it('its timeout is the gate job timeout', () => {
    expect(Number.isInteger(timeoutOf(gate()))).toBe(true);
    expect(timeoutOf(copy())).toBe(timeoutOf(gate()));
  });

  it('neither workflow sets env or defaults for all its jobs, which would reach the copy and not the gate, or the reverse', () => {
    for (const file of [GATE_FILE, REPEAT_FILE]) {
      const keys = blocksAt(codeLines(workflowText(file)), 0).map((block) => block.key);
      expect(keys, file).toContain('jobs');
      expect(keys, file).not.toContain('env');
      expect(keys, file).not.toContain('defaults');
    }
  });
});

describe('no copy can be mistaken for the required check', () => {
  it('the required check is the gate job of gate.yml, and no job of gate-repeat.yml is named or called gate', () => {
    expect(jobsOf(workflowText(GATE_FILE)).map(checkNameOf)).toEqual(['gate']);
    const jobs = jobsOf(workflowText(REPEAT_FILE));
    expect(jobs.map((job) => job.id)).toEqual(expect.arrayContaining(['plan', 'copy', 'timing']));
    for (const job of jobs) {
      expect(job.id, `the id of ${job.id}`).not.toBe('gate');
      expect(checkNameOf(job), `the check name of ${job.id}`).not.toBe('gate');
    }
  });

  it('the workflow itself is not named gate', () => {
    const name = blocksAt(codeLines(workflowText(REPEAT_FILE)), 0).find((block) => block.key === 'name');
    expect(name, 'the workflow has a name').toBeDefined();
    expect(unquote(name?.inline ?? '')).not.toBe('gate');
  });
});

describe('gate-repeat can only be started by hand', () => {
  it('its only trigger is workflow_dispatch', () => {
    expect(triggersOf(workflowText(REPEAT_FILE))).toEqual(['workflow_dispatch']);
  });
});

describe('only the timing job may swallow a failing command or run the timing suite', () => {
  /** Every job of every workflow but the timing job, as `file#job`. */
  const otherJobs = (): { key: string; job: Job }[] =>
    workflowFiles()
      .flatMap((file) => jobsOf(workflowText(file)).map((job) => ({ key: `${file}#${job.id}`, job })))
      .filter(({ key }) => key !== TIMING_JOB);

  it('no other job has a line that lets a failure pass, bar the one allowed in plan', () => {
    const jobs = otherJobs();
    // The sweep reaches the gate job, the copy job and plan, or an empty list would pass.
    expect(jobs.map(({ key }) => key)).toEqual(
      expect.arrayContaining([`${GATE_FILE}#gate`, `${REPEAT_FILE}#copy`, `${REPEAT_FILE}#plan`]),
    );
    for (const { key, job } of jobs) expect(swallowingLines(job.body), key).toEqual(SWALLOW_ALLOWED[key] ?? []);
  });

  it('the swallow allowed in plan is followed by a check that fails the job on an empty or malformed commit', () => {
    const plan = jobNamed(workflowText(REPEAT_FILE), 'plan').body.map((line) => line.trim());
    const [allowed] = SWALLOW_ALLOWED[`${REPEAT_FILE}#plan`];
    const at = plan.indexOf(allowed);
    expect(at, 'the allowed line is in plan').toBeGreaterThanOrEqual(0);
    expect(plan[at + 1]).toMatch(/^if ! .*\$sha.*grep -Eq /);
    expect(plan.slice(at + 2, at + 4)).toContain('exit 1');
  });

  it('no other job runs, or names, the timing suite', () => {
    for (const { key, job } of otherJobs()) expect(job.body.filter((line) => TIMING_TEXT.test(line)), key).toEqual([]);
    const timing = jobNamed(workflowText(REPEAT_FILE), 'timing').body;
    expect(timing.some((line) => line.includes('npm run test:timing'))).toBe(true);
  });
});

describe('the workflow checks are not vacuous', () => {
  const gateJob = [
    'jobs:',
    '  gate:',
    '    name: gate',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 45',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
    '      - name: Gate',
    '        run: npm run gate:ci',
  ];
  const copyJob = (...steps: string[]): string[] => [
    'jobs:',
    '  copy:',
    '    name: repeat ${{ matrix.attempt }}',
    '    needs: plan',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 45',
    '    steps:',
    ...steps,
  ];
  const checkout = ['      - uses: actions/checkout@v4'];
  const refWith = ['        with:', '          ref: ${{ needs.plan.outputs.ref }}'];
  const gate = (): Job => jobNamed(gateJob.join('\n'), 'gate');
  const copyStepsOf = (...lines: string[]) => withoutCopyRef(stepsOf(jobNamed(copyJob(...lines).join('\n'), 'copy')));
  const gateStep = ['      - name: Gate', '        run: npm run gate:ci'];

  it('reads jobs, check names, settings and steps through comments, blank lines and CRLF', () => {
    const text = ['# a comment', ...gateJob, '      # another', ''].join('\r\n');
    expect(jobsOf(text).map((job) => job.id)).toEqual(['gate']);
    expect(checkNameOf(jobNamed(text, 'gate'))).toBe('gate');
    expect(timeoutOf(jobNamed(text, 'gate'))).toBe(45);
    expect(stepsOf(jobNamed(text, 'gate'))).toHaveLength(2);
    expect(checkNameOf(jobNamed(copyJob(...gateStep).join('\n'), 'copy'))).toBe('repeat ${{ matrix.attempt }}');
    // A job with no name is shown by its id, and a quoted name loses its quotes.
    expect(checkNameOf({ id: 'build', body: [], keys: [] })).toBe('build');
    expect(checkNameOf({ id: 'x', body: [], keys: [{ key: 'name', inline: '"gate"', body: [] }] })).toBe('gate');
  });

  it('finds a step, a setting, a timeout and an extra step that differ from the gate job', () => {
    const same = copyStepsOf(...checkout, ...refWith, '', ...gateStep);
    expect(same.removed).toBe(1);
    expect(same.steps).toEqual(stepsOf(gate()));
    const changed = copyStepsOf(...checkout, ...refWith, '      - name: Gate', '        run: npm run gate');
    expect(changed.steps).not.toEqual(stepsOf(gate()));
    const extra = copyStepsOf(...checkout, ...refWith, ...gateStep, '      - run: echo done');
    expect(extra.steps).not.toEqual(stepsOf(gate()));
    const guarded = copyStepsOf(...checkout, ...refWith, ...gateStep, '        if: always()');
    expect(guarded.steps).not.toEqual(stepsOf(gate()));
    const slower = jobNamed(copyJob(...gateStep).join('\n').replace('timeout-minutes: 45', 'timeout-minutes: 60'), 'copy');
    expect(timeoutOf(slower)).not.toBe(timeoutOf(gate()));
    expect(jobSettings(slower)).not.toEqual(jobSettings(gate()));
    const env = jobNamed(copyJob(...gateStep).join('\n').replace('    steps:', '    env:\n      CI: x\n    steps:'), 'copy');
    expect(jobSettings(env)).not.toEqual(jobSettings(gate()));
    // The identity keys are not settings: the copy's name, needs and strategy are not compared.
    expect(jobSettings(jobNamed(copyJob(...gateStep).join('\n'), 'copy'))).toEqual(jobSettings(gate()));
  });

  it('allows the checkout ref and nothing like it', () => {
    expect(copyStepsOf(...checkout, ...refWith).removed).toBe(1);
    expect(copyStepsOf(...checkout).removed).toBe(0);
    // Another `with:` on the checkout, or a ref from somewhere else, is a difference.
    expect(copyStepsOf(...checkout, '        with:', '          ref: main').removed).toBe(0);
    expect(copyStepsOf(...checkout, '        with:', '          fetch-depth: 0').removed).toBe(0);
    expect(copyStepsOf(...checkout, ...refWith, '          fetch-depth: 0').removed).toBe(0);
    // The ref is allowed on a checkout step only.
    expect(copyStepsOf('      - uses: actions/setup-node@v4', ...refWith).removed).toBe(0);
  });

  it('reads the trigger from every form of on:', () => {
    const on = (...lines: string[]): string[] => triggersOf([...lines, 'jobs:', '  a:', '    runs-on: x'].join('\n'));
    expect(on('on:', '  workflow_dispatch:', '    inputs:', '      runs:', '        type: number')).toEqual(['workflow_dispatch']);
    expect(on('on:', '  workflow_dispatch:', '  pull_request:')).toEqual(['workflow_dispatch', 'pull_request']);
    expect(on('on:', '  push:', '    branches: [main]', '  schedule:', '    - cron: "0 0 * * *"')).toEqual(['push', 'schedule']);
    expect(on('on:', '  - workflow_dispatch', '  - push')).toEqual(['workflow_dispatch', 'push']);
    expect(on('on:', '- push')).toEqual(['push']);
    expect(on('on: push')).toEqual(['push']);
    expect(on('on: [workflow_dispatch, pull_request]')).toEqual(['workflow_dispatch', 'pull_request']);
    expect(on('"on":', '  pull_request:')).toEqual(['pull_request']);
    expect(triggersOf(workflowText(GATE_FILE))).toEqual(['pull_request']);
  });

  it('finds every way a line lets a failure pass, and none in a plain line or an expression', () => {
    for (const line of [
      'run: npm run test:timing || true',
      'run: npm run test:timing || status=$?',
      'run: npm run test:timing || :',
      'run: npm run test:timing || exit 0',
      '  continue-on-error: true',
      '  Continue-On-Error: ${{ matrix.x }}',
      'set +e',
      'run: npm run test:timing; true',
      'run: npm run test:timing ; exit 0',
      '  exit 0',
      '  shell: bash {0}',
    ]) {
      expect(swallowingLines([line]), line).toEqual([line.trim()]);
    }
    for (const line of [
      'run: npm run gate:ci',
      'group: gate-repeat-${{ inputs.pr || github.ref }}',
      'if: always()',
      'if: failure()',
      'run: set -e',
      '  exit 1',
      '  shell: bash',
    ]) {
      expect(swallowingLines([line]), line).toEqual([]);
    }
  });

  it('finds the timing suite in a job by any of its names, and not in the gate scripts', () => {
    for (const line of [
      'run: npm run test:timing',
      'run: npx vitest run --config vitest.timing.config.mts',
      'run: npx vitest run tests/timing',
      'run: npx vitest run x.timing.test.ts',
    ]) {
      expect(TIMING_TEXT.test(line), line).toBe(true);
    }
    expect(TIMING_TEXT.test('run: npm run gate:ci')).toBe(false);
  });
});
