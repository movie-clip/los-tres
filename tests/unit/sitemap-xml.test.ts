import { describe, expect, it } from 'vitest';

import { renderSitemapIndex, renderUrlset } from '@/server/catalogue/sitemap-xml';

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

describe('sitemap XML', () => {
  it('renders a urlset with the declaration, the namespace and one url per loc', () => {
    const xml = renderUrlset(['https://example.test/', 'https://example.test/producto/a']);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`<urlset xmlns="${NS}">`);
    expect(xml).toContain('<url><loc>https://example.test/</loc></url>');
    expect(xml).toContain('<url><loc>https://example.test/producto/a</loc></url>');
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml).toContain('</urlset>');
  });

  it('renders a sitemapindex with one sitemap per loc', () => {
    const xml = renderSitemapIndex(['https://example.test/sitemaps/paginas.xml']);
    expect(xml).toContain(`<sitemapindex xmlns="${NS}">`);
    expect(xml).toContain('<sitemap><loc>https://example.test/sitemaps/paginas.xml</loc></sitemap>');
    expect(xml).toContain('</sitemapindex>');
    expect(xml).not.toContain('<urlset');
  });

  it('renders an empty set as a valid empty document', () => {
    expect(renderUrlset([])).toContain(`<urlset xmlns="${NS}"></urlset>`);
    expect(renderSitemapIndex([])).toContain(`<sitemapindex xmlns="${NS}"></sitemapindex>`);
  });

  it('escapes the five XML characters in a loc', () => {
    const xml = renderUrlset(['https://example.test/c?a=1&b=<2>"x"\'y\'']);
    expect(xml).toContain(
      '<loc>https://example.test/c?a=1&amp;b=&lt;2&gt;&quot;x&quot;&apos;y&apos;</loc>',
    );
  });

  it('carries no lastmod', () => {
    expect(renderUrlset(['https://example.test/'])).not.toContain('lastmod');
  });
});
