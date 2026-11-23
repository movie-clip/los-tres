import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

// No clock in the gate (run 2026-11-23-no-clock-in-gate, S-1, 02-design § Where the
// timings live): the gate asserts no wall-clock time. Real timings live in
// tests/timing/ and run only by `npm run test:timing`, a separate Vitest config.
// This file pins that the gate cannot pick them up and that the separate config
// still sets up the same database as the integration project. Later slices of the
// run add their own describes here (the retry and directive rules).

type ProjectConfig = {
  resolve?: { alias?: Record<string, string> };
  test?: {
    name?: string;
    include?: string[];
    maxWorkers?: number;
    fileParallelism?: boolean;
    globalSetup?: string[];
    setupFiles?: string[];
  };
};
type LoadedConfig = { default: { test: { projects: ProjectConfig[] } } };

// The configs sit outside tests/ and TypeScript cannot resolve a `.mts` path
// without allowImportingTsExtensions, so they load by a computed specifier.
async function loadConfig(file: string): Promise<LoadedConfig> {
  const href = pathToFileURL(path.resolve(process.cwd(), file)).href;
  return (await import(/* @vite-ignore */ href)) as LoadedConfig;
}

const read = (file: string): string => readFileSync(path.resolve(process.cwd(), file), 'utf8');

const TIMING_FILE = 'tests/timing/x.timing.test.ts';

/** True when any include pattern of a project matches a file under tests/timing. */
function includesTimingFile(patterns: string[] | undefined): boolean {
  return (patterns ?? []).some((pattern) => path.posix.matchesGlob(TIMING_FILE, pattern));
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
    expect(includesTimingFile(undefined)).toBe(false);
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
    for (const name of ['test', 'test:unit', 'test:integration', 'gate', 'gate:ci']) {
      expect(scripts[name], name).toBeDefined();
      expect(scripts[name], name).not.toContain('test:timing');
      expect(scripts[name], name).not.toContain('vitest.timing');
    }
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
