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

export const DEMO_COUNTS = { products: 3, offers: 4, feeds: 2, shops: 2 } as const;
