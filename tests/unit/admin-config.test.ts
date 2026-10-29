import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import nextConfig from '../../next.config';
import { getAuthSecret, getSiteUrl } from '@/config/auth';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SESSION_LIFETIME_HOURS } from '@/server/auth/config';

// The admin area's settings and response headers (AC 13, AC 23, AC 24, D-9, D-11).

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('admin response headers (AC 23, AC 24)', () => {
  async function rulesFor(source: string) {
    const rules = await nextConfig.headers?.();
    return (rules ?? []).filter((rule) => rule.source === source);
  }

  it.each(['/admin', '/admin/:path*'])('marks %s noindex and no-store', async (source) => {
    const rules = await rulesFor(source);
    expect(rules).toHaveLength(1);
    const headers = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
    expect(headers['x-robots-tag']).toMatch(/noindex/);
    expect(headers['x-robots-tag']).toMatch(/nofollow/);
    // Containment: Next may add directives of its own on a dynamic page.
    expect(headers['cache-control']).toMatch(/no-store/);
  });

  it('puts those headers on the admin paths only, never on a public path', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      // The one public rule (S5.4) is the search page's referrer policy and sets nothing else.
      if (rule.source === '/buscar') {
        expect(rule.headers).toEqual([{ key: 'Referrer-Policy', value: 'same-origin' }]);
        continue;
      }
      expect(rule.source.startsWith('/admin')).toBe(true);
    }
  });

  it('declares noindex in the admin layout metadata too', async () => {
    const layout = readFileSync(path.resolve(process.cwd(), 'src/app/admin/layout.tsx'), 'utf8');
    expect(layout).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});

describe('the session settings (D-9, D-11)', () => {
  it('fixes the lifetime at 8 hours and the password length at 6 to 128', () => {
    expect(SESSION_LIFETIME_HOURS).toBe(8);
    expect(PASSWORD_MIN_LENGTH).toBe(6);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it('offers no remember-me or longer lifetime anywhere in the auth code', () => {
    const root = process.cwd();
    const auth = readFileSync(path.join(root, 'src/server/auth/auth.ts'), 'utf8');
    const actions = readFileSync(path.join(root, 'src/server/auth/actions.ts'), 'utf8');
    expect(auth).toMatch(/disableSessionRefresh:\s*true/);
    expect(auth).toMatch(/cookieCache:\s*\{\s*enabled:\s*false/);
    expect(`${auth}${actions}`).not.toMatch(/rememberMe|dont_remember|updateAge/);
  });
});

describe('AUTH_SECRET and SITE_URL (src/config/auth.ts)', () => {
  it('reads the secret at call time and demands 32 characters', () => {
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(32));
    expect(getAuthSecret()).toBe('x'.repeat(32));
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(31));
    expect(() => getAuthSecret()).toThrow('AUTH_SECRET');
    vi.stubEnv('AUTH_SECRET', '');
    expect(() => getAuthSecret()).toThrow('AUTH_SECRET is not set');
  });

  it('never puts the secret in an error', () => {
    vi.stubEnv('AUTH_SECRET', 'short-sentinel');
    try {
      getAuthSecret();
    } catch (error) {
      expect((error as Error).message).not.toContain('short-sentinel');
    }
  });

  it('reduces SITE_URL to its origin and refuses anything that is not http or https', () => {
    vi.stubEnv('SITE_URL', 'https://example.test:8443/some/path?q=1');
    expect(getSiteUrl()).toBe('https://example.test:8443');
    vi.stubEnv('SITE_URL', 'ftp://example.test');
    expect(() => getSiteUrl()).toThrow('SITE_URL');
    vi.stubEnv('SITE_URL', 'not a url');
    expect(() => getSiteUrl()).toThrow('SITE_URL');
    vi.stubEnv('SITE_URL', '');
    expect(() => getSiteUrl()).toThrow('SITE_URL is not set');
  });
});

describe('the create-admin entry points (AC 2, AC 3)', () => {
  const root = process.cwd();

  it('is a verb of the image entrypoint and of npm, and of both usage lines', () => {
    const entry = readFileSync(path.join(root, 'docker-entrypoint.sh'), 'utf8');
    expect(entry).toMatch(/migrate\|seed\|import-feeds\|create-admin\)/);
    expect(entry).toMatch(/usage: docker-entrypoint\.sh [^\n]*create-admin/);
    const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(scripts['create-admin']).toMatch(/dist\/cli\/create-admin\.js/);
  });

  it('reads no credential from the command line: the only argv use is the refusal of any argument', () => {
    const code = readFileSync(path.join(root, 'src/cli/create-admin.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    const uses = code.split(/\r?\n/).filter((line) => /argv|parseArgs|--password|--email|commander|yargs/.test(line));
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/process\.argv\.length\s*>\s*2/);
    // And the password is read from stdin, not the environment.
    expect(code).toMatch(/readCredentials/);
    expect(code).not.toMatch(/process\.env/);
  });

  it('never passes the credentials to a logger', () => {
    const code = readFileSync(path.join(root, 'src/cli/create-admin.ts'), 'utf8');
    for (const line of code.split(/\r?\n/).filter((entry) => /console\.(log|error|warn|info)/.test(entry))) {
      expect(line).not.toMatch(/\$\{(email|password)\}|,\s*(email|password)\b/);
    }
  });
});
