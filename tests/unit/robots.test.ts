import { afterEach, describe, expect, it, vi } from 'vitest';

import robots from '@/app/robots';

afterEach(() => {
  vi.unstubAllEnvs();
});

type Rule = { allow?: string | string[]; disallow?: string | string[] };
const rules = (): Rule[] => {
  const { rules: r } = robots();
  return Array.isArray(r) ? r : [r];
};
const asList = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

describe('robots.txt rules', () => {
  it('allows the site and disallows /go/, /api/ and the reserved /buscar', () => {
    vi.stubEnv('SITE_URL', 'https://example.test');
    const all = rules();
    expect(all.flatMap((rule) => asList(rule.allow))).toContain('/');
    const disallowed = all.flatMap((rule) => asList(rule.disallow));
    expect(disallowed).toEqual(expect.arrayContaining(['/go/', '/api/', '/buscar']));
  });

  it('keeps the admin area out of the file (it sends noindex itself)', () => {
    vi.stubEnv('SITE_URL', 'https://example.test');
    expect(JSON.stringify(robots())).not.toMatch(/admin/i);
  });

  it('points at the sitemap index on the public origin', () => {
    vi.stubEnv('SITE_URL', 'https://example.test/ignored?x=1');
    expect(robots().sitemap).toBe('https://example.test/sitemap.xml');
  });

  it('has no Sitemap line when no origin is configured', () => {
    vi.stubEnv('SITE_URL', undefined);
    expect(robots().sitemap).toBeUndefined();
    expect(rules().flatMap((rule) => asList(rule.disallow))).toContain('/go/');
  });
});
