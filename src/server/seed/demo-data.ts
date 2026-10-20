// The demo data constants (C-18). Everything here is fictional: shops and
// products say DEMO, hosts use the reserved `.example` TLD, and the EANs in
// demo/feeds use the GS1 internal-use prefix 200 so they cannot collide with a
// real product.

export const demoNetwork = { slug: 'demo', name: 'Red demo' } as const;

export const demoShops = [
  { slug: 'tienda-demo-uno', name: 'Tienda Demo Uno', feedFile: 'tienda-demo-uno.csv' },
  { slug: 'tienda-demo-dos', name: 'Tienda Demo Dos', feedFile: 'tienda-demo-dos.csv' },
] as const;

/** Two roots with children, in display order. */
export const demoCategories = [
  {
    slug: 'automovil',
    name: 'Automóvil',
    children: [
      { slug: 'aceites-y-lubricantes', name: 'Aceites y lubricantes' },
      { slug: 'filtros', name: 'Filtros' },
      { slug: 'escobillas-y-bombillas', name: 'Escobillas y bombillas' },
    ],
  },
  {
    slug: 'herramientas',
    name: 'Herramientas',
    children: [
      { slug: 'herramientas-electricas', name: 'Herramientas eléctricas' },
      { slug: 'herramientas-manuales', name: 'Herramientas manuales' },
    ],
  },
] as const;

/**
 * Each demo feed's own category strings, deliberately different per shop, and
 * the category they map to. A feed category absent here (Jardín > Cortacésped,
 * or an empty cell) stays unmapped, so its product is not public. No mapping
 * points at `aceites-y-lubricantes`: it is the empty demo category.
 */
export const demoCategoryMappings = [
  { feedFile: 'tienda-demo-uno.csv', feedCategory: 'Recambios > Filtros', categorySlug: 'filtros' },
  {
    feedFile: 'tienda-demo-uno.csv',
    feedCategory: 'Recambios > Iluminación',
    categorySlug: 'escobillas-y-bombillas',
  },
  {
    feedFile: 'tienda-demo-uno.csv',
    feedCategory: 'Bricolaje > Taladros',
    categorySlug: 'herramientas-electricas',
  },
  { feedFile: 'tienda-demo-dos.csv', feedCategory: 'Filtros de aceite', categorySlug: 'filtros' },
  {
    feedFile: 'tienda-demo-dos.csv',
    feedCategory: 'Herramienta manual',
    categorySlug: 'herramientas-manuales',
  },
] as const;
