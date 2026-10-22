import { getPublicOrigin } from '@/config/site';
import { categoryPath, absoluteUrl, productPath } from '@/server/catalogue/paths';
import {
  getSitemapCategorySlugs,
  getSitemapProductSlugs,
} from '@/server/catalogue/sitemap';
import { renderUrlset } from '@/server/catalogue/sitemap-xml';

// Public route (guardrail 3). One sitemap file: `paginas.xml` (home and the
// category pages) or `productos-<n>.xml` (one chunk of products). Which
// products and categories are listed is decided in src/server/catalogue/sitemap
// through the visibility scope (guardrail 1). Anything else is 404.

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ file: string }> };

const HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'no-store',
};

const PRODUCT_FILE = /^productos-([1-9][0-9]*)\.xml$/;

function empty(status: number): Response {
  return new Response(null, { status, headers: HEADERS });
}

export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const { file } = await params;
  const chunkMatch = PRODUCT_FILE.exec(file);
  const chunk = chunkMatch?.[1] ? Number(chunkMatch[1]) : null;
  if (file !== 'paginas.xml' && (chunk === null || !Number.isSafeInteger(chunk))) {
    return empty(404);
  }

  const origin = getPublicOrigin();
  if (origin === null) return empty(503);

  let paths: string[];
  if (chunk === null) {
    const categorySlugs = await getSitemapCategorySlugs();
    paths = ['/', ...categorySlugs.map((slug) => categoryPath(slug))];
  } else {
    const slugs = await getSitemapProductSlugs(chunk);
    if (slugs === null) return empty(404);
    paths = slugs.map((slug) => productPath(slug));
  }
  const locs = paths.map((path) => absoluteUrl(origin, path));
  return new Response(renderUrlset(locs), { status: 200, headers: HEADERS });
}
