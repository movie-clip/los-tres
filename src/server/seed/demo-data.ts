// The demo data constants (C-18). Everything here is fictional: shops and
// products say DEMO, hosts use the reserved `.example` TLD, and the EANs in
// demo/feeds use the GS1 internal-use prefix 200 so they cannot collide with a
// real product.

import type { FixedCategorySlug } from '../../db/category-tree';

export const demoNetwork = { slug: 'demo', name: 'Red demo' } as const;

export const demoShops = [
  { slug: 'tienda-demo-uno', name: 'Tienda Demo Uno', feedFile: 'tienda-demo-uno.csv' },
  { slug: 'tienda-demo-dos', name: 'Tienda Demo Dos', feedFile: 'tienda-demo-dos.csv' },
  { slug: 'tienda-demo-tres', name: 'Tienda Demo Tres', feedFile: 'tienda-demo-tres.csv' },
  { slug: 'tienda-demo-cuatro', name: 'Tienda Demo Cuatro', feedFile: 'tienda-demo-cuatro.csv' },
] as const;

/**
 * Each demo feed's own category strings, deliberately different per shop, and
 * the fixed category they map to (the tree itself is `FIXED_CATEGORY_TREE`; the
 * seed creates no category). Each of the four feeds words its categories its own
 * way. A feed category absent here (Bricolaje > Taladros, Herramienta manual,
 * Jardín > Cortacésped, or an empty cell) stays unmapped, so its product is not
 * public. No mapping points at `filtros-de-combustible`: it is the empty demo
 * category.
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
  { feedFile: 'tienda-demo-dos.csv', feedCategory: 'Aceites', categorySlug: 'aceite-de-motor' },
  { feedFile: 'tienda-demo-dos.csv', feedCategory: 'Filtros de aire', categorySlug: 'filtros-de-aire' },
  { feedFile: 'tienda-demo-dos.csv', feedCategory: 'Filtros de habitáculo', categorySlug: 'filtros-de-habitaculo' },
  { feedFile: 'tienda-demo-tres.csv', feedCategory: 'Mantenimiento > Aceites y lubricantes', categorySlug: 'aceite-de-motor' },
  { feedFile: 'tienda-demo-tres.csv', feedCategory: 'Mantenimiento > Filtros > Aceite', categorySlug: 'filtros-de-aceite' },
  { feedFile: 'tienda-demo-tres.csv', feedCategory: 'Mantenimiento > Filtros > Aire', categorySlug: 'filtros-de-aire' },
  { feedFile: 'tienda-demo-tres.csv', feedCategory: 'Mantenimiento > Filtros > Habitáculo', categorySlug: 'filtros-de-habitaculo' },
  { feedFile: 'tienda-demo-cuatro.csv', feedCategory: 'Aceite motor', categorySlug: 'aceite-de-motor' },
  { feedFile: 'tienda-demo-cuatro.csv', feedCategory: 'Filtro aceite', categorySlug: 'filtros-de-aceite' },
  { feedFile: 'tienda-demo-cuatro.csv', feedCategory: 'Filtro aire', categorySlug: 'filtros-de-aire' },
  { feedFile: 'tienda-demo-cuatro.csv', feedCategory: 'Filtro cabina', categorySlug: 'filtros-de-habitaculo' },
] as const satisfies readonly {
  feedFile: string;
  feedCategory: string;
  categorySlug: FixedCategorySlug;
}[];
