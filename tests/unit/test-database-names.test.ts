import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  baseDatabaseName,
  expectedWorkerDatabase,
  isIntegrationDatabase,
  parseWorkerId,
  templateDatabaseName,
  workerDatabaseName,
  workerDatabaseUrl,
} from '../support/env';

// Per-worker integration databases (S2, #336): the pure naming helpers behind
// tests/support/global-setup.ts, test-database-env.ts and assertTestDatabase.
// Fake passwords only; no real URL enters a test.

// The config file is the only place the worker count can live (it must not
// import from tests/), and TypeScript cannot resolve a `.mts` path without
// allowImportingTsExtensions, so it is loaded by a computed specifier.
type IntegrationWorkers = (env: Record<string, string | undefined>, cpus: number) => number;
const CONFIG = path.resolve(process.cwd(), 'vitest.config.mts');
const { integrationWorkers } = (await import(/* @vite-ignore */ pathToFileURL(CONFIG).href)) as {
  integrationWorkers: IntegrationWorkers;
};

const URL_OF_DEV = 'postgres://lostres:pw-secret@127.0.0.1:5433/lostres';

describe('database names', () => {
  it('names the template and each worker after the base, ending in _test', () => {
    expect(templateDatabaseName('lostres')).toBe('lostres_tpl_test');
    expect(workerDatabaseName('lostres', 1)).toBe('lostres_w1_test');
    expect(workerDatabaseName('lostres', 12)).toBe('lostres_w12_test');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses worker number %s', (worker) => {
    expect(() => workerDatabaseName('lostres', worker)).toThrow(/positive integer/);
  });

  it('refuses a base that is not a plain identifier, or that makes a name over 63 characters', () => {
    expect(() => workerDatabaseName('lostres"; drop database x; --', 1)).toThrow(/plain identifier/);
    expect(() => templateDatabaseName('has space')).toThrow(/plain identifier/);
    expect(() => workerDatabaseName('a'.repeat(60), 1)).toThrow(/63/);
    expect(workerDatabaseName('a'.repeat(50), 1)).toHaveLength(50 + '_w1_test'.length);
  });
});

describe('isIntegrationDatabase (what global setup may drop)', () => {
  it.each(['lostres_tpl_test', 'lostres_w1_test', 'lostres_w8_test', 'lostres_w123_test', 'lostres_test'])(
    'owns %s',
    (name) => {
      expect(isIntegrationDatabase(name, 'lostres')).toBe(true);
    },
  );

  it.each([
    'lostres',
    'postgres',
    'template1',
    'lostres_e2e_0a1b2c3d',
    'lostres_w_test',
    'lostres_w1a_test',
    'lostres_w1_test_x',
    'lostres_wx1_test',
    'lostres_tpl',
    'lostres_tpl_test_x',
    'lostres_test_test',
    'lostres2_w1_test',
    'other_w1_test',
    'other_tpl_test',
    'xlostres_w1_test',
  ])('never owns %s', (name) => {
    expect(isIntegrationDatabase(name, 'lostres')).toBe(false);
  });

  it('treats a base with regex characters as plain text', () => {
    expect(isIntegrationDatabase('a.c_w1_test', 'a.c')).toBe(true);
    expect(isIntegrationDatabase('abc_w1_test', 'a.c')).toBe(false);
  });
});

describe('parseWorkerId', () => {
  it('reads a positive integer within N', () => {
    expect(parseWorkerId('1', 8)).toBe(1);
    expect(parseWorkerId('8', 8)).toBe(8);
  });

  it('refuses a missing id, naming the worker as unknown and N', () => {
    expect(() => parseWorkerId(undefined, 4)).toThrow('integration worker unknown has no database; N=4');
    expect(() => parseWorkerId('', 4)).toThrow('integration worker unknown has no database; N=4');
  });

  it('refuses an id above N, naming the id and N', () => {
    expect(() => parseWorkerId('9', 8)).toThrow('integration worker 9 has no database; N=8');
  });

  it.each(['0', '-1', '1.5', '01', ' 1', '1 ', 'x', '1e1', '0x2'])('refuses id %j', (raw) => {
    expect(() => parseWorkerId(raw, 8)).toThrow(/has no database/);
  });

  it('without N, still refuses a missing or malformed id and accepts any positive one', () => {
    expect(() => parseWorkerId(undefined)).toThrow(/N=unknown/);
    expect(() => parseWorkerId('zero')).toThrow(/has no database/);
    expect(parseWorkerId('99')).toBe(99);
  });

  it('truncates a long junk id in the message', () => {
    const message = (() => {
      try {
        parseWorkerId('x'.repeat(200), 2);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    })();
    expect(message.length).toBeLessThan(80);
  });
});

describe('workerDatabaseUrl', () => {
  it('points the URL at the worker database and keeps host, port and credentials', () => {
    const url = new URL(workerDatabaseUrl(URL_OF_DEV, '3', 8));
    expect(url.pathname).toBe('/lostres_w3_test');
    expect(url.host).toBe('127.0.0.1:5433');
    expect(url.username).toBe('lostres');
    expect(url.password).toBe('pw-secret');
  });

  it('gives the same answer when the URL already names a worker database', () => {
    const once = workerDatabaseUrl(URL_OF_DEV, '3', 8);
    expect(workerDatabaseUrl(once, '3', 8)).toBe(once);
    expect(new URL(workerDatabaseUrl(once, '5', 8)).pathname).toBe('/lostres_w5_test');
  });

  it.each([undefined, '', '0', '9', 'abc'])('never yields a URL for worker id %j', (raw) => {
    expect(() => workerDatabaseUrl(URL_OF_DEV, raw, 8)).toThrow(/has no database; N=8/);
  });

  it('keeps the URL and the password out of a refusal', () => {
    for (const raw of [undefined, '99']) {
      try {
        workerDatabaseUrl(URL_OF_DEV, raw, 8);
        expect.unreachable();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain('pw-secret');
        expect(message).not.toContain('127.0.0.1');
      }
    }
  });
});

describe('baseDatabaseName and expectedWorkerDatabase', () => {
  it('maps a development, template-free or worker URL to the same base', () => {
    expect(baseDatabaseName(URL_OF_DEV)).toBe('lostres');
    expect(baseDatabaseName('postgres://u:p@h:1/lostres_w4_test')).toBe('lostres');
  });

  it('expects exactly the worker database of this process', () => {
    expect(expectedWorkerDatabase(URL_OF_DEV, '2')).toBe('lostres_w2_test');
    expect(expectedWorkerDatabase('postgres://u:p@h:1/lostres_w7_test', '2')).toBe('lostres_w2_test');
  });

  it('has no expected database without a worker id', () => {
    expect(() => expectedWorkerDatabase(URL_OF_DEV, undefined)).toThrow(/has no database/);
    expect(() => expectedWorkerDatabase(URL_OF_DEV, '0')).toThrow(/has no database/);
  });
});

describe('integrationWorkers (vitest.config.mts)', () => {
  it('defaults to min(8, cpus - 1)', () => {
    expect(integrationWorkers({}, 16)).toBe(8);
    expect(integrationWorkers({}, 9)).toBe(8);
    expect(integrationWorkers({}, 4)).toBe(3);
  });

  it('never goes below 1', () => {
    expect(integrationWorkers({}, 2)).toBe(1);
    expect(integrationWorkers({}, 1)).toBe(1);
    expect(integrationWorkers({}, 0)).toBe(1);
  });

  it('takes INTEGRATION_WORKERS over the default, even above 8', () => {
    expect(integrationWorkers({ INTEGRATION_WORKERS: '1' }, 16)).toBe(1);
    expect(integrationWorkers({ INTEGRATION_WORKERS: ' 12 ' }, 16)).toBe(12);
  });

  it('treats an empty INTEGRATION_WORKERS as unset', () => {
    expect(integrationWorkers({ INTEGRATION_WORKERS: '' }, 4)).toBe(3);
  });

  it.each(['0', '-2', '2.5', 'many', '1e1'])('refuses INTEGRATION_WORKERS=%s instead of falling back', (raw) => {
    expect(() => integrationWorkers({ INTEGRATION_WORKERS: raw }, 16)).toThrow(/INTEGRATION_WORKERS/);
  });
});
