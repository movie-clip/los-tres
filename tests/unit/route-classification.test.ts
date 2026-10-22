import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyRoute, listRouteFiles } from '../support/routes';

const appDir = path.resolve(process.cwd(), 'src/app');

describe('route classification (C-5, TD-6)', () => {
  const routes = listRouteFiles(appDir);

  it('finds the routes that exist', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('puts every page and route handler below (public) or admin', () => {
    const unclassified = routes.filter((file) => classifyRoute(file) === 'unclassified');
    expect(unclassified).toEqual([]);
  });

  it('keeps the two slice A entry points below (public)', () => {
    expect(routes).toEqual(
      expect.arrayContaining(['(public)/page.tsx', '(public)/api/health/route.ts']),
    );
    expect(classifyRoute('(public)/page.tsx')).toBe('public');
    expect(classifyRoute('(public)/api/health/route.ts')).toBe('public');
  });

  it('keeps the /go redirect route below (public)', () => {
    expect(routes).toContain('(public)/go/[offer]/route.ts');
    expect(classifyRoute('(public)/go/[offer]/route.ts')).toBe('public');
  });

  it('keeps the category page below (public)', () => {
    expect(routes).toContain('(public)/categoria/[slug]/page.tsx');
    expect(classifyRoute('(public)/categoria/[slug]/page.tsx')).toBe('public');
  });

  it('keeps the sign-in page and the shell below admin (US-2.1)', () => {
    const admin = routes.filter((file) => classifyRoute(file) === 'admin');
    expect(admin).toEqual(expect.arrayContaining(['admin/acceso/page.tsx', 'admin/(shell)/page.tsx']));
    // No admin page or route sits outside the admin directory by another name.
    expect(routes.filter((file) => /admin|acceso/.test(file) && classifyRoute(file) !== 'admin')).toEqual([]);
  });

  it('has no public route that looks like sign-up, reset or the framework auth handler (AC 1)', () => {
    const lookalike = routes.filter((file) =>
      /sign-?up|register|registr|reset|forgot|olvid|restablec|api\/auth/i.test(file),
    );
    expect(lookalike).toEqual([]);
  });

  it('detects a route placed outside the two directories', () => {
    expect(classifyRoute('page.tsx')).toBe('unclassified');
    expect(classifyRoute('api/leak/route.ts')).toBe('unclassified');
    expect(classifyRoute('admin/feeds/page.tsx')).toBe('admin');
  });
});
