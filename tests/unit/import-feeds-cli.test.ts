import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The arguments of `import-feeds` (S3.3, AC 12): `[]`, `--feed <id>` and `--feed <id>
// --allow-large-removal` are the only forms; anything else prints the usage line and exits 2 without
// importing. The CLI main runs on import, so each case sets argv, imports a fresh copy of the module
// and waits for the exit code. The importer and the pool are replaced: this proves the parsing only.

const hoisted = vi.hoisted(() => ({
  importFeeds: vi.fn(),
  notRegistered: false,
}));

vi.mock('@/db/client', () => ({ getDb: () => ({}), closeDb: async () => {} }));
vi.mock('@/server/importer', async () => {
  const types = await import('@/server/importer/types');
  return {
    FeedNotRegisteredError: types.FeedNotRegisteredError,
    formatImportReport: () => 'report-sentinel',
    importExitCode: () => 0,
    importFeeds: async (...args: unknown[]) => {
      hoisted.importFeeds(...args);
      if (hoisted.notRegistered) throw new types.FeedNotRegisteredError();
      return { startedAt: new Date('2026-01-01T00:00:00Z'), feeds: [] };
    },
  };
});

const USAGE = 'usage: import-feeds [--feed <id> [--allow-large-removal]]';

let savedArgv: string[];
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  savedArgv = process.argv;
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
  hoisted.importFeeds.mockClear();
  hoisted.notRegistered = false;
});

afterEach(() => {
  process.argv = savedArgv;
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
});

/** Runs the CLI main with these arguments; returns its exit code and what it printed. */
async function runWith(...args: string[]) {
  const out = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.argv = ['node', 'import-feeds.js', ...args];
  vi.resetModules();
  await import('@/cli/import-feeds');
  await vi.waitFor(() => expect(process.exitCode).not.toBeUndefined());
  const result = {
    exitCode: process.exitCode,
    stdout: out.mock.calls.map((call) => call.join(' ')),
    stderr: err.mock.calls.map((call) => call.join(' ')),
  };
  out.mockRestore();
  err.mockRestore();
  return result;
}

function optionsOfTheImport(): { feedId?: number; allowLargeRemoval?: boolean } {
  expect(hoisted.importFeeds).toHaveBeenCalledTimes(1);
  return hoisted.importFeeds.mock.calls[0][1];
}

describe('accepted forms', () => {
  it('no argument imports every approved feed, with no override', async () => {
    const result = await runWith();
    expect(result).toMatchObject({ exitCode: 0, stdout: ['report-sentinel'], stderr: [] });
    const options = optionsOfTheImport();
    expect(options.feedId).toBeUndefined();
    expect(Boolean(options.allowLargeRemoval)).toBe(false);
  });

  it('--feed <id> imports that feed, with no override', async () => {
    const result = await runWith('--feed', '7');
    expect(result).toMatchObject({ exitCode: 0, stderr: [] });
    expect(optionsOfTheImport().feedId).toBe(7);
    expect(Boolean(optionsOfTheImport().allowLargeRemoval)).toBe(false);
  });

  it('--feed <id> --allow-large-removal passes the override for that feed', async () => {
    const result = await runWith('--feed', '7', '--allow-large-removal');
    expect(result).toMatchObject({ exitCode: 0, stdout: ['report-sentinel'], stderr: [] });
    const options = optionsOfTheImport();
    expect(options.feedId).toBe(7);
    expect(options.allowLargeRemoval).toBe(true);
  });

  it('an unregistered feed still exits 1 with the override', async () => {
    hoisted.notRegistered = true;
    const result = await runWith('--feed', '999999', '--allow-large-removal');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toEqual(['import-feeds: feed 999999 is not registered']);
  });
});

describe('refused forms print the usage line, exit 2 and import nothing', () => {
  it.each([
    { name: 'the override without --feed', args: ['--allow-large-removal'] },
    { name: 'the override before --feed', args: ['--allow-large-removal', '--feed', '7'] },
    { name: 'the override between --feed and its id', args: ['--feed', '--allow-large-removal', '7'] },
    { name: '--feed with no id', args: ['--feed'] },
    { name: '--feed with no id and the override', args: ['--feed', '--allow-large-removal'] },
    { name: 'a fourth argument', args: ['--feed', '7', '--allow-large-removal', 'extra'] },
    { name: 'a second override', args: ['--feed', '7', '--allow-large-removal', '--allow-large-removal'] },
    { name: 'an unknown third argument', args: ['--feed', '7', '--force'] },
    { name: 'a non-numeric id', args: ['--feed', 'abc'] },
    { name: 'a non-numeric id with the override', args: ['--feed', 'abc', '--allow-large-removal'] },
    { name: 'id zero', args: ['--feed', '0', '--allow-large-removal'] },
    { name: 'a negative id', args: ['--feed', '-3'] },
    { name: 'a decimal id', args: ['--feed', '1.5'] },
    { name: 'an id past the integer ceiling', args: ['--feed', '12345678901'] },
    { name: 'a stray first argument', args: ['7'] },
    { name: 'the override spelled with one dash', args: ['--feed', '7', '-allow-large-removal'] },
    { name: 'the override in another case', args: ['--feed', '7', '--ALLOW-LARGE-REMOVAL'] },
    { name: 'the override joined to the id', args: ['--feed=7', '--allow-large-removal'] },
  ])('$name', async ({ args }) => {
    const result = await runWith(...args);
    expect(result).toEqual({ exitCode: 2, stdout: [], stderr: [USAGE] });
    expect(hoisted.importFeeds).not.toHaveBeenCalled();
  });
});
