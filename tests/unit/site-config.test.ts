import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDatabaseUrl } from '@/config/env';
import { getPublicOrigin, getSiteName } from '@/config/site';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSiteName', () => {
  it('returns the configured value', () => {
    vi.stubEnv('SITE_NAME', 'Nombre Prueba');
    expect(getSiteName()).toBe('Nombre Prueba');
  });

  it('trims surrounding whitespace', () => {
    vi.stubEnv('SITE_NAME', '  Nombre Prueba \t');
    expect(getSiteName()).toBe('Nombre Prueba');
  });

  it('reads the environment on every call, not at module load', () => {
    vi.stubEnv('SITE_NAME', 'Primero');
    expect(getSiteName()).toBe('Primero');
    vi.stubEnv('SITE_NAME', 'Segundo');
    expect(getSiteName()).toBe('Segundo');
  });

  it('throws when SITE_NAME is unset', () => {
    vi.stubEnv('SITE_NAME', undefined);
    expect(() => getSiteName()).toThrow(new Error('SITE_NAME is not set'));
  });

  it.each(['', '   ', '\t\n'])('throws when SITE_NAME is blank (%j)', (blank) => {
    vi.stubEnv('SITE_NAME', blank);
    expect(() => getSiteName()).toThrow(new Error('SITE_NAME is not set'));
  });

  it('never puts other environment values in the error', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://someone:hunter2-sentinel@db.example:5432/x');
    vi.stubEnv('DB_PASSWORD', 'hunter2-sentinel');
    vi.stubEnv('SITE_NAME', undefined);
    let message = '';
    try {
      getSiteName();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('SITE_NAME is not set');
    expect(message).not.toContain('hunter2-sentinel');
  });
});

describe('getDatabaseUrl', () => {
  it('reads the environment on every call', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://a@h:1/one');
    expect(getDatabaseUrl()).toBe('postgres://a@h:1/one');
    vi.stubEnv('DATABASE_URL', 'postgres://a@h:1/two');
    expect(getDatabaseUrl()).toBe('postgres://a@h:1/two');
  });

  it('throws a fixed message when unset or blank, without echoing other values', () => {
    vi.stubEnv('SITE_NAME', 'sentinel-site');
    vi.stubEnv('DATABASE_URL', undefined);
    expect(() => getDatabaseUrl()).toThrow(new Error('DATABASE_URL is not set'));
    vi.stubEnv('DATABASE_URL', '  ');
    expect(() => getDatabaseUrl()).toThrow(new Error('DATABASE_URL is not set'));
  });
});

describe('getPublicOrigin', () => {
  it('is null when SITE_URL is unset or blank', () => {
    vi.stubEnv('SITE_URL', undefined);
    expect(getPublicOrigin()).toBeNull();
    vi.stubEnv('SITE_URL', '');
    expect(getPublicOrigin()).toBeNull();
  });

  it('is null for a value that is not http or https', () => {
    vi.stubEnv('SITE_URL', 'ftp://x.example');
    expect(getPublicOrigin()).toBeNull();
    vi.stubEnv('SITE_URL', 'not a url');
    expect(getPublicOrigin()).toBeNull();
  });

  it('reduces a valid value to its origin, without a trailing slash', () => {
    vi.stubEnv('SITE_URL', 'http://127.0.0.1:3000/x?q=1');
    expect(getPublicOrigin()).toBe('http://127.0.0.1:3000');
  });

  it('reads the environment on every call', () => {
    vi.stubEnv('SITE_URL', 'https://uno.example');
    expect(getPublicOrigin()).toBe('https://uno.example');
    vi.stubEnv('SITE_URL', 'https://dos.example');
    expect(getPublicOrigin()).toBe('https://dos.example');
  });
});
