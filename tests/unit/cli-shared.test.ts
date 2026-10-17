import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '@/cli/shared';

// Guardrail 5: a CLI main prints a short code and never an error message,
// because a driver message can carry a host, a URL or a row value.

let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  savedExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
});

describe('runCli', () => {
  it('sets the exit code from the main and prints nothing itself', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli('probe', async () => 2);
    expect(process.exitCode).toBe(2);
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('prints only an error code for a driver error, never its message', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const driverError = Object.assign(
      new Error('connect failed for postgres://user:hunter2-sentinel@db.example:5432/x'),
      { code: 'ECONNREFUSED' },
    );
    await runCli('probe', async () => {
      throw driverError;
    });
    expect(process.exitCode).toBe(1);
    const printed = JSON.stringify(error.mock.calls);
    expect(printed).toContain('ECONNREFUSED');
    expect(printed).not.toContain('hunter2-sentinel');
    expect(printed).not.toContain('postgres://');
    expect(printed).not.toContain('db.example');
  });

  it('prints a generic word for an error with no safe code', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCli('probe', async () => {
      throw new Error('row 3 had email someone@example.com');
    });
    const printed = JSON.stringify(error.mock.calls);
    expect(printed).not.toContain('someone@example.com');
    expect(process.exitCode).toBe(1);
  });

  it('names a missing variable but never a value', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCli('probe', async () => {
      throw new Error('DATABASE_URL is not set');
    });
    expect(JSON.stringify(error.mock.calls)).toContain('DATABASE_URL is not set');
  });
});
