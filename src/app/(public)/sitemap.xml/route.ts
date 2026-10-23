import { getPublicOrigin } from '@/config/site';
import { absoluteUrl } from '@/server/catalogue/paths';
import { countSitemapProductChunks } from '@/server/catalogue/sitemap';
import { renderSitemapIndex } from '@/server/catalogue/sitemap-xml';

// Public route (guardrail 3). The sitemap index: the page sitemap, then one
// entry per product chunk. Built per request (guardrail 1: a product hidden
// now leaves the sitemap on the next fetch); with no public origin configured
// the answer is 503 and an empty body.

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'no-store',
};

export async function GET(): Promise<Response> {
  const origin = getPublicOrigin();
  if (origin === null) return new Response(null, { status: 503, headers: HEADERS });

  const chunks = await countSitemapProductChunks();
  const locs = [absoluteUrl(origin, '/sitemaps/paginas.xml')];
  for (let chunk = 1; chunk <= chunks; chunk += 1) {
    locs.push(absoluteUrl(origin, `/sitemaps/productos-${chunk}.xml`));
  }
  return new Response(renderSitemapIndex(locs), { status: 200, headers: HEADERS });
}
