// Sitemap XML for the sitemaps.org 0.9 protocol (S6.2). Pure: no server-only,
// no database. `loc` only; there is no lastmod (products carry no updated_at).

const NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function render(root: string, item: string, locs: string[]): string {
  const entries = locs.map((loc) => `<${item}><loc>${escapeXml(loc)}</loc></${item}>`).join('');
  return `${DECLARATION}<${root} xmlns="${NAMESPACE}">${entries}</${root}>\n`;
}

/** A `<urlset>` with one `<url><loc>` per absolute URL. */
export function renderUrlset(locs: string[]): string {
  return render('urlset', 'url', locs);
}

/** A `<sitemapindex>` with one `<sitemap><loc>` per absolute sitemap URL. */
export function renderSitemapIndex(locs: string[]): string {
  return render('sitemapindex', 'sitemap', locs);
}
