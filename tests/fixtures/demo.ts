// Expected values of the shipped demo data (demo/feeds/*.csv, src/server/seed).
// The hosts use the reserved `.example` TLD and the EANs the GS1 internal-use
// prefix 200, so none of this can collide with a real shop or product.

export const DEMO_SHOP_HOSTS = ['tienda-demo-uno.example', 'tienda-demo-dos.example'] as const;

export const DEMO_FEED_URLS = [
  'demo-feed:tienda-demo-uno.csv',
  'demo-feed:tienda-demo-dos.csv',
] as const;

export const DEMO_SHOPS = [
  { slug: 'tienda-demo-uno', name: 'Tienda Demo Uno' },
  { slug: 'tienda-demo-dos', name: 'Tienda Demo Dos' },
] as const;

/** Sold by both demo shops: Dos (1149) is cheaper than Uno (1299). */
export const DEMO_SHARED = {
  slug: 'demo-filtro-de-aceite-oc-1234',
  title: 'DEMO Filtro de aceite OC 1234',
  brand: 'MarcaDemo',
  partNumber: 'OC 1234',
  ean: '2000000000015',
  offers: [
    { shopName: 'Tienda Demo Dos', priceCents: 1149 },
    { shopName: 'Tienda Demo Uno', priceCents: 1299 },
  ],
} as const;

export const DEMO_DRILL = {
  slug: 'demo-taladro-percutor-650-w',
  title: 'DEMO Taladro percutor 650 W',
  offers: [{ shopName: 'Tienda Demo Uno', priceCents: 4990 }],
} as const;

export const DEMO_WRENCHES = {
  slug: 'demo-juego-de-llaves-fijas-12-piezas',
  title: 'DEMO Juego de llaves fijas 12 piezas',
  offers: [{ shopName: 'Tienda Demo Dos', priceCents: 2999 }],
} as const;

/** Sold by Uno alone, no brand cell: the card renders no brand line. */
export const DEMO_NO_BRAND = {
  slug: 'demo-aceite-de-motor-5w-30-1-l',
  title: 'DEMO Aceite de motor 5W-30 1 L',
  priceCents: 650,
  categorySlug: 'aceite-de-motor',
} as const;

/** A 100-character title (UNO-004), to prove the card clamps instead of breaking the layout. */
export const DEMO_LONG_TITLE = {
  title:
    'DEMO Filtro de habitáculo de carbón activo con triple capa para varios modelos de turismo y furgones',
  priceCents: 1590,
} as const;

/** Mapped nowhere: never public, on any page (AC 24). */
export const DEMO_UNMAPPED_CATEGORY = {
  slug: 'demo-cortacesped-electrico-1200-w',
  title: 'DEMO Cortacésped eléctrico 1200 W',
} as const;

/** The feed row has an empty category cell: unmapped, never public (AC 3). */
export const DEMO_UNMAPPED_EMPTY = {
  slug: 'demo-banco-de-trabajo-plegable',
  title: 'DEMO Banco de trabajo plegable',
} as const;

/** 24 filler air filters FA-101..FA-124 (UNO-101..124), 5,55 EUR up in 0,60 steps; they fill filtros-de-aire. */
export const DEMO_FILLER = { count: 24, firstTitle: 'DEMO Filtro de aire FA-101', firstPriceCents: 555 } as const;

/** Public products per category subtree after one import (AC 9, 23). Keys are the fixed tree slugs. */
export const DEMO_CATEGORY_COUNTS = {
  'mantenimiento-del-coche': 27,
  'aceite-de-motor': 1,
  'filtros-de-aceite': 1,
  'filtros-de-aire': 24,
  'filtros-de-combustible': 0,
  'filtros-de-habitaculo': 1,
} as const;

/** After one import: 31 products and 32 offers, of which 27 products are public. */
export const DEMO_COUNTS = {
  products: 31,
  offers: 32,
  publicProducts: 27,
  feeds: 2,
  shops: 2,
  categoryMappings: 5,
} as const;

/** Rows per demo feed file and what a first import creates from them. */
export const DEMO_FEED_ROWS = { uno: 28, dos: 4, dosProductsCreated: 3 } as const;

/** Display names of the fixed categories, by slug (a unit test keeps this equal to FIXED_CATEGORY_TREE). */
export const DEMO_CATEGORY_NAMES = {
  'mantenimiento-del-coche': 'Mantenimiento del coche',
  'aceite-de-motor': 'Aceite de motor',
  'filtros-de-aceite': 'Filtros de aceite',
  'filtros-de-aire': 'Filtros de aire',
  'filtros-de-combustible': 'Filtros de combustible',
  'filtros-de-habitaculo': 'Filtros de habitáculo',
} as const;
