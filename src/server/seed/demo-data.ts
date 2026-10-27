// The demo data constants (C-18). Everything here is fictional: shops and
// products say DEMO, hosts use the reserved `.example` TLD, and the EANs in
// demo/feeds use the GS1 internal-use prefix 200 so they cannot collide with a
// real product.

import type { FixedCategorySlug } from '../../db/category-tree';

export const demoNetwork = { slug: 'demo', name: 'Red demo' } as const;

export const demoShops = [
  { slug: 'tienda-demo-uno', name: 'Tienda Demo Uno', feedFile: 'tienda-demo-uno.csv' },
  { slug: 'tienda-demo-dos', name: 'Tienda Demo Dos', feedFile: 'tienda-demo-dos.csv' },
] as const;

/**
 * Each demo feed's own category strings, deliberately different per shop, and
 * the fixed category they map to (the tree itself is `FIXED_CATEGORY_TREE`; the
 * seed creates no category). A feed category absent here (Bricolaje > Taladros,
 * Herramienta manual, Jardín > Cortacésped, or an empty cell) stays unmapped,
 * so its product is not public. No mapping points at `filtros-de-combustible`:
 * it is the empty demo category.
 */
export const demoCategoryMappings = [
  {
    feedFile: 'tienda-demo-uno.csv',
    feedCategory: 'Recambios > Filtros de aceite',
    categorySlug: 'filtros-de-aceite',
  },
  {
    feedFile: 'tienda-demo-uno.csv',
    feedCategory: 'Recambios > Filtros de aire',
    categorySlug: 'filtros-de-aire',
  },
  {
    feedFile: 'tienda-demo-uno.csv',
    feedCategory: 'Recambios > Filtros de habitáculo',
    categorySlug: 'filtros-de-habitaculo',
  },
  {
    feedFile: 'tienda-demo-uno.csv',
    feedCategory: 'Recambios > Aceites de motor',
    categorySlug: 'aceite-de-motor',
  },
  { feedFile: 'tienda-demo-dos.csv', feedCategory: 'Filtros de aceite', categorySlug: 'filtros-de-aceite' },
] as const satisfies readonly {
  feedFile: string;
  feedCategory: string;
  categorySlug: FixedCategorySlug;
}[];
