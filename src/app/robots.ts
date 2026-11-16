import type { MetadataRoute } from 'next';

import { getPublicOrigin } from '@/config/site';

// The public origin is read per request, so a changed value takes a container
// restart and not a rebuild. Without this, Next would render the file at build.
export const dynamic = 'force-dynamic';

// /buscar is the search page and /mi-coche the car picker (its `volver` can hold a
// search term). Both stay disallowed here and also send noindex.
// Private areas are kept out of this file on purpose: they send noindex
// themselves, and a disallow here would stop crawlers from reading it.
const DISALLOWED = ['/go/', '/api/', '/buscar', '/mi-coche'];

export default function robots(): MetadataRoute.Robots {
  const origin = getPublicOrigin();
  return {
    // No crawler is named: Next writes the wildcard group (`*`) itself.
    rules: { allow: '/', disallow: DISALLOWED },
    // No origin configured: no Sitemap line rather than a relative or wrong one.
    ...(origin === null ? {} : { sitemap: `${origin}/sitemap.xml` }),
  };
}
