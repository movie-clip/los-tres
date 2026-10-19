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

  it('detects a route placed outside the two directories', () => {
    expect(classifyRoute('page.tsx')).toBe('unclassified');
    expect(classifyRoute('api/leak/route.ts')).toBe('unclassified');
    expect(classifyRoute('admin/feeds/page.tsx')).toBe('admin');
  });
});
