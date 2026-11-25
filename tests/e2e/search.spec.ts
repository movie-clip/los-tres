import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED, DEMO_SHOP_HOSTS } from '../fixtures/demo';
import { aria, expectSmoke, PRICE, PRODUCTS, SHOPS } from '../support/smoke';

// S5.4 (US-5.4) against the Compose stack, demo data after one import: the smoke test of the results page and
// journey J1. The privacy proof (ACs 31 and 32) is search-privacy.spec.ts.

const MANY = 'filtro';

const url = (term: string, page?: number) =>
  `/buscar?q=${encodeURIComponent(term)}${page === undefined ? '' : `&pagina=${page}`}`;

const productHref = (slug: string) => `/producto/${slug}`;

// #339 (0006 rules 11 and 12): the smoke test of the search page family and journey J1.
test.describe('search smoke and journey (#339)', () => {
  test('S4 smoke: the results page answers 200, its main region matches and the console is clean', async ({ page }) => {
    await expectSmoke(
      page,
      url(MANY),
      aria`
        - heading "${messages.Search.heading}" [level=1]
        - search:
          - searchbox "${messages.Search.fieldLabel}": ${MANY}
          - button "${messages.Search.button}"
        - paragraph: /${PRODUCTS} para «${MANY}» · Página 1 de \d+/
        - list:
          - listitem:
            - heading /DEMO Filtro .+/ [level=2]:
              - link /DEMO Filtro .+/:
                - /url: /^\/producto\/demo-filtro-.+$/
            - text: /Ref\. \S+( ${messages.Category.priceFrom})? ${PRICE} ${SHOPS}/
        - navigation "${messages.Category.paginationLabel}":
          - link "${messages.Category.nextPage}":
            - /url: ${url(MANY, 2)}
      `,
    );
  });

  test('J1: search, the product page with its offers cheapest first, and the click-out to the shop', async ({
    page,
    context,
  }) => {
    const [cheaper, dearer] = DEMO_SHARED.offers;
    // The price as the page writes it: cents formatted with a decimal comma, the euro sign after U+00A0.
    const price = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}\\s€`;

    // Every request to /go/ from the first load on: the only one allowed is the click's.
    const goRequests: { url: string; referer: string | undefined }[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.startsWith('/go/')) {
        void req.headerValue('referer').then((referer) => goRequests.push({ url: req.url(), referer: referer ?? undefined }));
      }
    });

    // Search from the home form by the shared EAN, and open the one result.
    await page.goto('/');
    await page.getByRole('searchbox', { name: messages.Home.searchLabel }).fill(DEMO_SHARED.ean);
    await page.getByRole('button', { name: messages.Home.searchButton }).click();
    await expect(page).toHaveURL(new RegExp(`/buscar\\?q=${DEMO_SHARED.ean}$`));
    await page.getByRole('link', { name: DEMO_SHARED.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${productHref(DEMO_SHARED.slug)}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DEMO_SHARED.title);
    const productUrl = page.url();

    // Both shops, cheapest first, each with its price, and no shipping wording (money guardrail).
    const rows = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: /^Ir a la tienda de / }) });
    await expect(rows).toHaveCount(DEMO_SHARED.offers.length);
    await expect(rows.nth(0)).toHaveText(new RegExp(`${cheaper.shopName}.*${price(cheaper.priceCents)}`));
    await expect(rows.nth(1)).toHaveText(new RegExp(`${dearer.shopName}.*${price(dearer.priceCents)}`));
    expect(cheaper.priceCents).toBeLessThan(dearer.priceCents);
    await expect(page.getByRole('main')).not.toContainText(/env[ií]o/i);

    // No /go request on load, hover or focus of the offer links: they are not prefetched.
    await page.waitForLoadState('networkidle');
    const links = page.getByRole('link', { name: /^Ir a la tienda de / });
    for (let index = 0; index < DEMO_SHARED.offers.length; index += 1) {
      await links.nth(index).hover();
      await links.nth(index).focus();
    }
    await page.waitForLoadState('networkidle');
    expect(goRequests).toEqual([]);

    // The click on the cheaper offer is the one /go request; the browser follows it to that shop with the
    // product page as Referer, and no cookie is set. The shop host is reserved and never resolves.
    const shopRequest = page.waitForRequest((req) => new URL(req.url()).hostname === DEMO_SHOP_HOSTS[1]);
    await links.nth(0).click();
    await shopRequest;
    expect(goRequests).toHaveLength(1);
    expect(goRequests[0].referer).toBe(productUrl);
    expect(await context.cookies()).toEqual([]);
  });
});
