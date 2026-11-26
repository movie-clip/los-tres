import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHOP_HOSTS } from '../fixtures/demo';
import { CAR, carName, cocheValues, queryOf, scriptedControl, selectedText } from '../support/car';

// US-5.7 T5.7.5 (L3t), ACs 43 to 48, journey J7 of 0006 rule 12: while a car is selected every internal link on
// a public page carries `coche=<slug>` once, last. Amended AC 43 names four exceptions: the link to /go/<offer>,
// which carries no car (asserted below); the car control's own change and remove links (the sweep leaves that
// group out; their hrefs are pinned by unit/car-return-path.test.ts and unit/car-control.test.ts); the
// fit-change-car link of the all-left-out empty state (unit/fit-change-car-link.test.ts, which
// this journey never renders); and the vehicle list's tiles, links to their own car (checked below, outside the
// sweep). The crawl reads the rendered anchors, so a new link that forgets withCar fails here whichever page it
// is on. The helpers and the components are unit/car-links-seo.test.ts and car-links-components.test.ts.

const ROOT = '/categoria/mantenimiento-del-coche';

const join = (path: string, query: string): string => `${path}${path.includes('?') ? '&' : '?'}${query}`;

const isInternal = (href: string): boolean => href.startsWith('/') && !href.startsWith('//');

// #339 (0006 rule 12): journey J7, with a car selected: from the listing to a product with its fit banner, `coche`
// kept on the links of each page, and none of it through the click-out.
test.describe('with a car: listing, product, click-out journey (#339)', () => {
  /**
   * Every internal anchor outside the car control and the vehicle list: it ends in `coche=<slug>`, once, and is not
   * a /go link. The list's tiles are the one link whose car is not the selected one, so they are not in this sweep.
   *
   * Two things keep the read from catching the page mid-change (#381). It waits for the hydrated control first: a
   * page that is a document load starts with the header's change action as a link and swaps it for a button when
   * React hydrates, and a sweep during the swap reads a transient DOM. And it collects and filters in one
   * `page.evaluate`: `locator.evaluateAll` queries in one round trip and filters in a second, and a node the
   * hydration detaches between them has no ancestor, so `closest()` finds no group and the filter keeps it.
   */
  async function expectCarried(page: Page, name: string): Promise<void> {
    await scriptedControl(page, true);
    const hrefs = await page.evaluate((label) => {
      return Array.from(document.querySelectorAll('a[href]'))
        .filter(
          (node) =>
            node.closest(`[role="group"][aria-label="${label}"]`) === null &&
            node.closest('[data-testid="vehicle-list"]') === null,
        )
        .map((node) => node.getAttribute('href') ?? '');
    }, messages.Car.groupLabel);
    const carried = hrefs.filter((href) => isInternal(href) && !href.startsWith('/go/'));
    // Not vacuous: the logo and the three footer links are on every page.
    expect(carried.length, name).toBeGreaterThanOrEqual(4);
    for (const href of carried) {
      expect(cocheValues(href), `${name}: ${href}`).toEqual([CAR.slug]);
      expect(queryOf(href).at(-1), `${name}: ${href}`).toEqual(['coche', CAR.slug]);
    }
  }

  test('J7: the car stays on every link from the home page to a product, and the click-out to the shop carries none', async ({
    page,
    context,
    baseURL,
  }) => {
    const goRequests: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.startsWith('/go/')) goRequests.push(req.url());
    });

    await page.goto(join('/', `coche=${CAR.slug}`));
    await expect(page.getByRole('group', { name: messages.Car.groupLabel })).toContainText(selectedText(CAR));
    await expectCarried(page, 'home');

    // The listing, then a compatible product from its first group.
    await page.goto(join(ROOT, `coche=${CAR.slug}`));
    await expectCarried(page, 'category');
    const fits = page.getByRole('region', { name: messages.Fit.fitsHeading.replace('{car}', carName(CAR)) });
    await expect(fits).toBeVisible();
    await fits.getByRole('heading', { level: 3 }).first().getByRole('link').click();
    await expect(page).toHaveURL(/\/producto\//);
    expect(cocheValues(page.url())).toEqual([CAR.slug]);

    // The product page says, in words, that it fits the car, and its links carry the car.
    await expect(
      page.getByRole('note').filter({ hasText: messages.ProductFit.bannerFits.replace('{car}', carName(CAR)) }),
    ).toHaveCount(1);
    await expectCarried(page, 'product');
    // The vehicle list's tiles are links to the category for their own car: the category path, `coche` once, and nothing else.
    const tiles = await page
      .getByTestId('vehicle-list')
      .getByRole('link')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(tiles.length).toBeGreaterThan(0);
    for (const href of tiles) expect(href).toMatch(/^\/categoria\/[a-z0-9-]+\?coche=[a-z0-9-]+$/);
    expect(tiles).toContainEqual(expect.stringContaining(`coche=${CAR.slug}`));

    // The shop links are /go paths without the car, and so is the redirect they answer.
    const shopLinks = page.getByRole('link', { name: /^Ir a la tienda de / });
    const hrefs = await shopLinks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/go\/\d+$/);
      expect(href).not.toContain('coche');
    }
    const redirect = await page.request.get(hrefs[0], { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers()['location']).not.toContain('coche');

    // The click: the one /go request has no car, and the shop's request carries none in its Referer (at most our origin).
    const shopRequest = page.waitForRequest((req) => DEMO_SHOP_HOSTS.some((host) => new URL(req.url()).hostname === host));
    await shopLinks.first().click();
    const shop = await shopRequest;
    expect(goRequests).toHaveLength(1);
    expect(goRequests[0]).not.toContain('coche');
    const referer = await shop.headerValue('referer');
    expect(referer ?? '').not.toContain('coche');
    if (referer !== null) {
      const url = new URL(referer);
      expect(url.origin).toBe(new URL(baseURL ?? '').origin);
      expect(url.pathname + url.search).toBe('/');
    }
    expect(await context.cookies()).toEqual([]);
  });
});
