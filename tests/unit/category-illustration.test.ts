import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  CategoryIllustration,
  ILLUSTRATION_KEYS,
  toIllustrationKey,
} from '@/components/CategoryIllustration';
import { FIXED_CATEGORY_TREE } from '@/db/category-tree';

import messages from '../../messages/es-ES.json';

// S11.2 O1: all five drawings, fuel included, are checked here because the demo
// catalogue shows no fuel-filter product on screen.

const render = (key: (typeof ILLUSTRATION_KEYS)[number]) =>
  renderToStaticMarkup(createElement(CategoryIllustration, { illustration: key }));

describe('CategoryIllustration', () => {
  it('has exactly one drawing per child of the fixed category tree', () => {
    expect([...ILLUSTRATION_KEYS]).toEqual(FIXED_CATEGORY_TREE.children.map((child) => child.slug));
  });

  describe.each(ILLUSTRATION_KEYS)('%s', (key) => {
    const html = render(key);

    it('is one decorative 120 x 120 svg', () => {
      expect(html.match(/<svg\b/g)).toHaveLength(1);
      expect(html).toContain('viewBox="0 0 120 120"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('focusable="false"');
      expect(html).toContain('data-testid="category-illustration"');
      expect(html).not.toMatch(/<svg[^>]*\s(width|height)=/);
    });

    it('draws at least one shape', () => {
      expect(html).toMatch(/<(rect|path|circle|ellipse|line|polygon|polyline)\b/);
    });

    it('carries no colour, gradient, opacity, transform or inline style: CSS Modules paint it', () => {
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb|hsl|gradient|opacity|transform|style=/i);
      expect(html).not.toMatch(/\b(fill|stroke)="/);
    });

    it('has a non-empty product-page label message', () => {
      const label = (messages.Product.imageByCategory as Record<string, string>)[key];
      expect(typeof label).toBe('string');
      expect(label.trim()).not.toBe('');
    });
  });

  it('draws five different pictures', () => {
    expect(new Set(ILLUSTRATION_KEYS.map(render)).size).toBe(ILLUSTRATION_KEYS.length);
  });
});

describe('toIllustrationKey', () => {
  it.each(ILLUSTRATION_KEYS)('returns %s unchanged', (key) => {
    expect(toIllustrationKey(key)).toBe(key);
  });

  it.each([[FIXED_CATEGORY_TREE.slug], [''], ['categoria-desconocida'], ['Filtros-De-Aire']])(
    'returns null for %j, never throwing',
    (slug) => {
      expect(toIllustrationKey(slug)).toBeNull();
    },
  );
});
