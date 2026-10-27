import { describe, expect, it } from 'vitest';

import { FIXED_CATEGORY_TREE } from '@/db/category-tree';

import { DEMO_CATEGORY_COUNTS, DEMO_CATEGORY_NAMES } from '../fixtures/demo';

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// The slugs are public URLs (/categoria/<slug>) and nothing redirects a renamed
// one: changing this constant must fail the gate on purpose (S4.0).
describe('FIXED_CATEGORY_TREE (S4.0)', () => {
  it('is exactly the approved tree: one root and five children, in position order', () => {
    expect(FIXED_CATEGORY_TREE).toEqual({
      slug: 'mantenimiento-del-coche',
      name: 'Mantenimiento del coche',
      position: 0,
      children: [
        { slug: 'aceite-de-motor', name: 'Aceite de motor', position: 0 },
        { slug: 'filtros-de-aceite', name: 'Filtros de aceite', position: 1 },
        { slug: 'filtros-de-aire', name: 'Filtros de aire', position: 2 },
        { slug: 'filtros-de-combustible', name: 'Filtros de combustible', position: 3 },
        { slug: 'filtros-de-habitaculo', name: 'Filtros de habitáculo', position: 4 },
      ],
    });
  });

  it('has well-formed, unique slugs and strictly increasing child positions', () => {
    const slugs = [FIXED_CATEGORY_TREE.slug, ...FIXED_CATEGORY_TREE.children.map((child) => child.slug)];
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(SLUG_FORMAT);
    const positions: number[] = FIXED_CATEGORY_TREE.children.map((child) => child.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('keeps the e2e fixtures (names and demo counts) on the same six slugs', () => {
    const slugs = [FIXED_CATEGORY_TREE.slug, ...FIXED_CATEGORY_TREE.children.map((child) => child.slug)].sort();
    expect(Object.keys(DEMO_CATEGORY_NAMES).sort()).toEqual(slugs);
    expect(Object.keys(DEMO_CATEGORY_COUNTS).sort()).toEqual(slugs);
    expect(DEMO_CATEGORY_NAMES[FIXED_CATEGORY_TREE.slug]).toBe(FIXED_CATEGORY_TREE.name);
    for (const child of FIXED_CATEGORY_TREE.children) {
      expect(DEMO_CATEGORY_NAMES[child.slug]).toBe(child.name);
    }
  });

  it('has a demo root count equal to the sum of its children', () => {
    const sum = FIXED_CATEGORY_TREE.children.reduce((total, child) => total + DEMO_CATEGORY_COUNTS[child.slug], 0);
    expect(DEMO_CATEGORY_COUNTS[FIXED_CATEGORY_TREE.slug]).toBe(sum);
  });
});
