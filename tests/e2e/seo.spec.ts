import { expect, test } from '@playwright/test';

import { DEMO_SHARED } from '../fixtures/demo';
import { expectNoSetCookie, openRawHtml } from '../support/page-checks';

// S6.2 against the Compose stack. Every e2e product is a demo product, so the
// indexable side (canonical on a real product or category) is proven in the
// unit and integration projects; here the demo catalogue must stay out of the
// sitemap and carry noindex. SITE_URL is the browser origin (CLAUDE.md).

const demoPath = `/producto/${DEMO_SHARED.slug}`;

test.describe('robots.txt, sitemap and canonicals (S6.2)', () => {
  test('serves robots.txt as plain text with the private paths disallowed and the sitemap named', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');
    expectNoSetCookie(response);
    const body = await response.text();
    const lines = body.split(/\r?\n/);
    expect(lines).toContain('Allow: /');
    expect(lines).toContain('Disallow: /go/');
    expect(lines).toContain('Disallow: /api/');
    expect(lines).toContain('Disallow: /buscar');
    expect(lines).toContain(`Sitemap: ${new URL(baseURL ?? '').origin}/sitemap.xml`);
    expect(body).not.toMatch(/admin/i);
  });

  test('serves the sitemap index and keeps every demo product out of every file it lists', async ({
    request,
  }) => {
    const index = await request.get('/sitemap.xml');
    expect(index.status()).toBe(200);
    expect(index.headers()['content-type']).toContain('xml');
    expect(index.headers()['cache-control']).toBe('no-store');
    expectNoSetCookie(index);
    const indexBody = await index.text();
    expect(indexBody).toContain('<sitemapindex');
    const locs = [...indexBody.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs.some((loc) => loc.endsWith('/sitemaps/paginas.xml'))).toBe(true);

    for (const loc of locs) {
      const file = await request.get(new URL(loc).pathname);
      expect(file.status()).toBe(200);
      const body = await file.text();
      expect(body).toContain('<urlset');
      expect(body).not.toContain('/producto/demo-');
      expect(body).not.toContain(DEMO_SHARED.slug);
      expect(body).not.toMatch(/admin/i);
    }
  });

  test('lists only the home in paginas.xml while every category is demo-only', async ({ request, baseURL }) => {
    const body = await (await request.get('/sitemaps/paginas.xml')).text();
    const origin = new URL(baseURL ?? '').origin;
    expect(body).toContain(`<loc>${origin}/</loc>`);
    expect(body).not.toContain('/categoria/');
  });

  test('answers 404 for an unknown sitemap file', async ({ request }) => {
    expect((await request.get('/sitemaps/foo.xml')).status()).toBe(404);
    expect((await request.get('/sitemaps/productos-99.xml')).status()).toBe(404);
  });

  test('marks a demo product page noindex and gives it no canonical', async ({ request, browser }) => {
    const response = await request.get(demoPath);
    expect(response.status()).toBe(200);
    const { page, close } = await openRawHtml(browser, await response.text());
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await close();
  });

  test('marks a demo-only category page noindex and gives it no canonical', async ({ request, browser }) => {
    const response = await request.get('/categoria/filtros');
    expect(response.status()).toBe(200);
    const { page, close } = await openRawHtml(browser, await response.text());
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await close();
  });

  test('gives the home page a canonical on the public origin and no noindex', async ({
    request,
    browser,
    baseURL,
  }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const { page, close } = await openRawHtml(browser, await response.text());
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${new URL(baseURL ?? '').origin}/`,
    );
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    await close();
  });

  test('sends X-Robots-Tag: noindex, nofollow from /go, redirect or refusal', async ({ request }) => {
    const html = await (await request.get(demoPath)).text();
    const href = /href="(\/go\/\d+)"/.exec(html)?.[1];
    expect(href).toBeTruthy();
    const redirect = await request.get(href as string, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers()['x-robots-tag']).toBe('noindex, nofollow');
    const refusal = await request.get('/go/999999', { maxRedirects: 0 });
    expect(refusal.status()).toBe(404);
    expect(refusal.headers()['x-robots-tag']).toBe('noindex, nofollow');
  });
});
