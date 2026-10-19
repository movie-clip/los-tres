import { expect, test, type APIRequestContext } from '@playwright/test';

import { DEMO_SHARED, DEMO_SHOP_HOSTS } from '../fixtures/demo';
import { expectNoSetCookie } from '../support/page-checks';

// /go/<offer> against the Compose stack. Every offer here is a demo offer, so
// e2e can show the redirect but never a counted row (that is proven in the
// integration project). Offer ids are read from the product page, never
// hard-coded: ids are not stable across re-seeds.

const productPath = `/producto/${DEMO_SHARED.slug}`;

async function offerHrefs(request: APIRequestContext): Promise<string[]> {
  const html = await (await request.get(productPath)).text();
  const hrefs = [...html.matchAll(/href="(\/go\/\d+)"/g)].map((match) => match[1]);
  expect(hrefs).toHaveLength(DEMO_SHARED.offers.length);
  return hrefs;
}

test.describe('/go/<offer> (S1.1)', () => {
  test('redirects a demo offer to its shop with no cookie, no body and no-store', async ({ request }) => {
    const [href] = await offerHrefs(request);
    const response = await request.get(href, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const location = new URL(response.headers()['location']);
    expect(DEMO_SHOP_HOSTS as readonly string[]).toContain(location.hostname);
    expect(response.headers()['cache-control']).toBe('no-store');
    expectNoSetCookie(response);
    expect(await response.text()).toBe('');
  });

  test('answers HEAD and OPTIONS with the same redirect', async ({ request }) => {
    const [href] = await offerHrefs(request);
    const get = await request.get(href, { maxRedirects: 0 });
    for (const method of ['HEAD', 'OPTIONS']) {
      const response = await request.fetch(href, { method, maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers()['location']).toBe(get.headers()['location']);
      expectNoSetCookie(response);
    }
  });

  for (const id of ['999999', 'abc', '0', '01']) {
    test(`answers 404 with no cookie for /go/${id}`, async ({ request }) => {
      const response = await request.get(`/go/${id}`, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(response.headers()['location']).toBeUndefined();
      expectNoSetCookie(response);
    });
  }

  test('a click on the cheaper offer is sent to that shop, with the product page as referer and no cookie', async ({
    page,
    context,
  }) => {
    // Playwright does not route the redirect target of a navigation, so the
    // browser's own request to the reserved .example host (which never
    // resolves, so nothing leaves the machine) is what proves it followed.
    const goRequests: { url: string; referer: string | undefined }[] = [];
    page.on('request', async (req) => {
      if (new URL(req.url()).pathname.startsWith('/go/')) {
        goRequests.push({ url: req.url(), referer: (await req.allHeaders())['referer'] });
      }
    });

    await page.goto(productPath);
    const productUrl = page.url();
    // The cheaper offer is listed first.
    expect(DEMO_SHARED.offers[0].shopName).toBe('Tienda Demo Dos');
    const shopRequest = page.waitForRequest(
      (req) => new URL(req.url()).hostname === 'tienda-demo-dos.example',
    );

    await page.getByTestId('offer-go').first().click();
    await shopRequest;

    expect(goRequests).toHaveLength(1);
    expect(goRequests[0].referer).toBe(productUrl);
    expect(await context.cookies()).toEqual([]);
  });

  test('requests no /go URL on load, hover or focus of the offer links (no prefetch)', async ({ page }) => {
    const goRequests: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.startsWith('/go/')) goRequests.push(req.url());
    });

    await page.goto(productPath);
    await page.waitForLoadState('networkidle');
    const links = page.getByTestId('offer-go');
    const count = await links.count();
    expect(count).toBe(DEMO_SHARED.offers.length);
    for (let index = 0; index < count; index += 1) {
      await links.nth(index).hover();
      await links.nth(index).focus();
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    expect(goRequests).toEqual([]);
  });
});
