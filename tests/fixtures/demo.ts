// Expected values of the shipped demo data (demo/feeds/*.csv, src/server/seed).
// The hosts use the reserved `.example` TLD and the EANs the GS1 internal-use
// prefix 200, so none of this can collide with a real shop or product.

export const DEMO_SHOP_HOSTS = [
  'tienda-demo-uno.example',
  'tienda-demo-dos.example',
  'tienda-demo-tres.example',
  'tienda-demo-cuatro.example',
] as const;

export const DEMO_FEED_URLS = [
  'demo-feed:tienda-demo-uno.csv',
  'demo-feed:tienda-demo-dos.csv',
  'demo-feed:tienda-demo-tres.csv',
  'demo-feed:tienda-demo-cuatro.csv',
] as const;

export const DEMO_SHOPS = [
  { slug: 'tienda-demo-uno', name: 'Tienda Demo Uno' },
  { slug: 'tienda-demo-dos', name: 'Tienda Demo Dos' },
  { slug: 'tienda-demo-tres', name: 'Tienda Demo Tres' },
  { slug: 'tienda-demo-cuatro', name: 'Tienda Demo Cuatro' },
] as const;

/** Sold by both demo shops: Dos (1149) is cheaper than Uno (1299). */
export const DEMO_SHARED = {
  slug: 'demo-filtro-de-aceite-oc-1234',
  title: 'DEMO Filtro de aceite OC 1234',
  brand: 'MarcaDemo',
  partNumber: 'OC 1234',
  ean: '2000000000015',
  categorySlug: 'filtros-de-aceite',
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

/** The cheapest public product on the root page (page one, first card): one offer. */
export const DEMO_CHEAPEST = {
  slug: 'demo-filtro-de-aceite-purflux-of-2041',
  title: 'DEMO Filtro de aceite Purflux OF-2041',
  priceCents: 390,
  offerCount: 1,
} as const;

/** Sold by all four demo shops; `offers` is the display order, cheapest first. */
export const DEMO_FOUR_OFFERS = {
  slug: 'demo-filtro-de-aire-mahle-af-4163',
  categorySlug: 'filtros-de-aire',
  offers: [
    { shopName: 'Tienda Demo Dos', priceCents: 1195 },
    { shopName: 'Tienda Demo Tres', priceCents: 1295 },
    { shopName: 'Tienda Demo Cuatro', priceCents: 1395 },
    { shopName: 'Tienda Demo Uno', priceCents: 1530 },
  ],
} as const;

/** One public product per populated leaf, to prove each category's own illustration. */
export const DEMO_ILLUSTRATED = {
  'aceite-de-motor': 'demo-aceite-mobil-5w-30-sintetico-4-l',
  'filtros-de-aceite': 'demo-filtro-de-aceite-bosch-of-3306',
  'filtros-de-aire': 'demo-filtro-de-aire-mahle-af-4163',
  'filtros-de-habitaculo': 'demo-filtro-de-habitaculo-mahle-ca-1118-antipolen',
} as const;

/** Public products per category subtree after one import (AC 9, 23). Keys are the fixed tree slugs. */
export const DEMO_CATEGORY_COUNTS = {
  'mantenimiento-del-coche': 50,
  'aceite-de-motor': 16,
  'filtros-de-aceite': 12,
  'filtros-de-aire': 12,
  'filtros-de-combustible': 0,
  'filtros-de-habitaculo': 10,
} as const;

/** After one import: 54 products and 124 offers, of which 50 products are public. */
export const DEMO_COUNTS = {
  products: 54,
  offers: 124,
  publicProducts: 50,
  feeds: 4,
  shops: 4,
  categoryMappings: 16,
} as const;

/** Rows per demo feed file and the products a first import creates from each, in seed order. */
export const DEMO_FEED_ROWS = {
  uno: { rows: 39, productsCreated: 39 },
  dos: { rows: 35, productsCreated: 5 },
  tres: { rows: 28, productsCreated: 8 },
  cuatro: { rows: 22, productsCreated: 2 },
} as const;

/** Display names of the fixed categories, by slug (a unit test keeps this equal to FIXED_CATEGORY_TREE). */
export const DEMO_CATEGORY_NAMES = {
  'mantenimiento-del-coche': 'Mantenimiento del coche',
  'aceite-de-motor': 'Aceite de motor',
  'filtros-de-aceite': 'Filtros de aceite',
  'filtros-de-aire': 'Filtros de aire',
  'filtros-de-combustible': 'Filtros de combustible',
  'filtros-de-habitaculo': 'Filtros de habitáculo',
} as const;
