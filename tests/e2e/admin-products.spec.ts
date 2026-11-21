import { spawnSync } from "node:child_process";

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import messages from "../../messages/es-ES.json";
import { DEMO_FEED_URLS, DEMO_SHARED, DEMO_SHOP_HOSTS } from "../fixtures/demo";
import { signInAs } from "../support/admin-e2e";
import { startIsolatedApp, type IsolatedApp } from "../support/isolated-app";
import {
  expectNoSetCookie,
  expectServerRenderedNotFound,
} from "../support/page-checks";

// US-2.4 from sign-in to a product and an offer hidden and unhidden through the screens, with what
// each does to the public page, `/go` and search, the list state kept, the keyboard, the failure
// line, and the app output holding no feed address and no search term (guardrail 5). Desktop width
// only: admin screens are not checked at phone width.
//
// The demo product is hidden for real, so the spec runs against an app container of its own on a
// database of its own (tests/support/isolated-app.ts: the same image, the demo data seeded and
// imported, removed at the end). Hiding it on the Compose app would change the counts and pages that
// the other specs read in parallel, and a row added there changes `admin-categories.spec.ts`'s demo
// fingerprint. The development database is never written: nothing is left to restore. It owns its own
// admin account, on that database.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const EMAIL = "e2e-hide-admin@example.test";
const PASSWORD = "e2e-hide-password-1";

const copy = messages.Admin.Products;
const detail = messages.Admin.Products.Detail;
const siteName = (process.env.SITE_NAME ?? "").trim();

const SLUG = DEMO_SHARED.slug;
const TITLE = DEMO_SHARED.title;
const TERM = DEMO_SHARED.ean; // an exact EAN finds this product alone, in the admin list and in the public search
const [CHEAPER, DEARER] = DEMO_SHARED.offers; // Tienda Demo Dos (11,49), Tienda Demo Uno (12,99)

let app: IsolatedApp;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  app = await startIsolatedApp("admin-products.spec.ts");
  app.createAdmin(EMAIL, PASSWORD);
});

test.afterAll(() => {
  app?.stop();
});

async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: app.origin });
  const page = await context.newPage();
  await signInAs(page, EMAIL, PASSWORD);
  return page;
}

const productId = (): number =>
  Number(app.psqlScalar(`select id from products where slug = '${SLUG}'`));
const productHidden = (): boolean =>
  app.psqlScalar(`select is_hidden from products where slug = '${SLUG}'`) ===
  "t";

const offerWhere = (shop: string): string =>
  `from offers o join products p on p.id = o.product_id join feeds f on f.id = o.feed_id join shops s on s.id = f.shop_id where p.slug = '${SLUG}' and s.name = '${shop}'`;
const offerId = (shop: string): number =>
  Number(app.psqlScalar(`select o.id ${offerWhere(shop)}`));
const offerHidden = (shop: string): boolean =>
  app.psqlScalar(`select o.is_hidden ${offerWhere(shop)}`) === "t";

/** What the public site answers for the product page, `/go` of each offer (cheaper first) and a search for the term. */
async function publicState(request: APIRequestContext) {
  const page = await request.get(`/producto/${SLUG}`, { maxRedirects: 0 });
  expectNoSetCookie(page);
  const go: number[] = [];
  for (const offer of [CHEAPER, DEARER]) {
    const response = await request.get(`/go/${offerId(offer.shopName)}`, {
      maxRedirects: 0,
    });
    expectNoSetCookie(response);
    go.push(response.status());
  }
  const search = await request.get(`/buscar?q=${TERM}`);
  expectNoSetCookie(search);
  return {
    page: page.status(),
    pageHtml: await page.text(),
    go,
    searchHtml: await search.text(),
  };
}

const composeAppLogs = (): string => {
  const result = spawnSync(
    "docker",
    ["compose", "logs", "app", "--no-log-prefix"],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

const offerRow = (page: Page, shop: string) =>
  page.getByTestId("offer-row").filter({ hasText: shop });

test.describe("hide and unhide from the admin screens (US-2.4)", () => {
  let publicRequest: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    publicRequest = await playwright.request.newContext({
      baseURL: app.origin,
    });
  });
  test.afterAll(async () => {
    await publicRequest?.dispose();
  });

  test("finds the product from the list by its EAN and shows it not hidden and on the site", async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto("/admin/productos");
    await expect(
      page.getByRole("heading", { level: 1, name: copy.heading }),
    ).toBeVisible();

    await page.getByLabel(copy.searchLabel).fill(TERM);
    await page.getByTestId("products-search-submit").click();

    await expect(page).toHaveURL(new RegExp(`[?&]q=${TERM}(&|$)`));
    const rows = page.getByTestId("product-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.getByTestId("product-row-title")).toHaveText(TITLE);
    await expect(rows.getByTestId("product-row-tag")).toHaveText(
      copy.tagNotHidden,
    );
    await expect(rows.getByTestId("product-row-public")).toContainText(
      copy.publicNowYes,
    );
    await expect(page.getByLabel(copy.searchLabel)).toHaveValue(TERM);
  });

  test("the baseline is public: the page answers 200, both offers redirect and the search finds it (non-vacuity)", async () => {
    const state = await publicState(publicRequest);
    expect(state.page).toBe(200);
    expect(state.go).toEqual([302, 302]);
    expect(state.searchHtml).toContain(TITLE);
  });

  test("hides the product: it says so in words, and the public page, /go and search answer as if it did not exist", async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    await expect(page.getByTestId("product-tag")).toHaveText(copy.tagNotHidden);

    await page.getByTestId("product-toggle-button").click();

    await expect(page.getByTestId("product-done")).toHaveText(
      detail.doneProductHidden,
    );
    await expect(page.getByTestId("product-tag")).toHaveText(copy.tagHidden);
    await expect(page.getByTestId("product-public")).toContainText(
      copy.publicNowNo,
    );
    await expect(page.getByTestId("product-toggle-button")).toHaveText(
      detail.unhideProduct,
    );
    expect(productHidden()).toBe(true);
    // The two offers are not changed by it (the flags are independent).
    expect(offerHidden(CHEAPER.shopName)).toBe(false);
    expect(offerHidden(DEARER.shopName)).toBe(false);

    const state = await publicState(publicRequest);
    expect(state.page).toBe(404);
    expectServerRenderedNotFound(state.pageHtml, siteName);
    expect(state.go).toEqual([404, 404]);
    expect(state.searchHtml).not.toContain(TITLE);
  });

  test("keeps the term, the hidden-only filter and the page on the product page and its back link, and after a press", async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos?q=${TERM}&ocultos=1`);
    await expect(page.getByTestId("product-row")).toHaveCount(1);
    await expect(page.getByTestId("product-row-tag")).toHaveText(
      copy.tagHidden,
    );
    await expect(page.getByTestId("products-hidden-only")).toBeChecked();

    await page.getByTestId("product-row-title").click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/productos/${productId()}\\?`),
    );
    const arrived = page.url();
    expect(arrived).toContain(`q=${TERM}`);
    expect(arrived).toContain("ocultos=1");

    // Back link on an address that also carries a page: all three survive in it.
    await page.goto(
      `/admin/productos/${productId()}?q=${TERM}&ocultos=1&pagina=2`,
    );
    const back = await page.getByTestId("product-back").getAttribute("href");
    expect(back).toContain(`q=${TERM}`);
    expect(back).toContain("ocultos=1");
    expect(back).toContain("pagina=2");

    // Unhide from this page: the press does not navigate, so the address is the same afterwards.
    await page.goto(arrived);
    await page.getByTestId("product-toggle-button").click();
    await expect(page.getByTestId("product-done")).toHaveText(
      detail.doneProductUnhidden,
    );
    expect(page.url()).toBe(arrived);
    expect(productHidden()).toBe(false);

    // The list the back link leads to still has the term and the filter; the product is no longer in it.
    await page.getByTestId("product-back").click();
    await expect(page.getByLabel(copy.searchLabel)).toHaveValue(TERM);
    await expect(page.getByTestId("products-hidden-only")).toBeChecked();
    await expect(page.getByTestId("product-row")).toHaveCount(0);
    await expect(page.getByTestId("products-empty")).toBeVisible();
  });

  test("after the unhide the product is back on the public site with both offers, and the line never says it was published", async ({
    browser,
  }) => {
    const state = await publicState(publicRequest);
    expect(state.page).toBe(200);
    expect(state.go).toEqual([302, 302]);
    expect(state.searchHtml).toContain(TITLE);

    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    // The line of a press tells what was saved, not that the site now shows it (AC 59).
    await page.getByTestId("product-toggle-button").click();
    await expect(page.getByTestId("product-done")).toHaveText(
      detail.doneProductHidden,
    );
    await page.getByTestId("product-toggle-button").click();
    await expect(page.getByTestId("product-done")).toHaveText(
      detail.doneProductUnhidden,
    );
    await expect(page.getByTestId("product-done")).not.toContainText(
      /aparece|publica|visible en el sitio/i,
    );
  });

  test("hides one offer from the keyboard: the other offer still redirects, the page lists one shop, and it unhides", async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    const first = offerRow(page, CHEAPER.shopName);
    await expect(first).toHaveCount(1);

    // Operable with the keyboard alone: focus the control, press Enter.
    const button = first.getByTestId("offer-toggle-button");
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(first.getByTestId("offer-done")).toHaveText(
      detail.doneOfferHidden,
    );
    await expect(first.getByTestId("offer-tag")).toHaveText(
      copy.tagOfferHidden,
    );
    await expect(button).toBeFocused();
    expect(offerHidden(CHEAPER.shopName)).toBe(true);
    expect(productHidden()).toBe(false);

    const state = await publicState(publicRequest);
    expect(state.page).toBe(200);
    expect(state.go).toEqual([404, 302]);
    expect(state.pageHtml).toContain(DEARER.shopName);
    expect(state.pageHtml).not.toContain(CHEAPER.shopName);

    await button.press("Space");
    await expect(first.getByTestId("offer-done")).toHaveText(
      detail.doneOfferUnhidden,
    );
    expect(offerHidden(CHEAPER.shopName)).toBe(false);
    expect((await publicState(publicRequest)).go).toEqual([302, 302]);
  });

  test("a failed save shows the error block and changes nothing", async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    await page.waitForLoadState("networkidle");
    await page.route("**/admin/productos/**", async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
      ) {
        await route.fulfill({ status: 500, body: "boom" });
      } else {
        await route.continue();
      }
    });

    await page.getByTestId("product-toggle-button").click();

    await expect(page.getByTestId("admin-error")).toContainText(
      detail.errorTitle,
    );
    await expect(page.getByTestId("admin-error")).toContainText(
      detail.errorProductBody,
    );
    await expect(page.getByTestId("product-done")).toHaveCount(0);
    expect(productHidden()).toBe(false);
  });

  test("the app output holds no feed address, no shop host, no search term and no credential after all of it (guardrail 5)", async ({
    browser,
  }) => {
    // One more search, hide and unhide, then read the output of the isolated app and of the Compose app.
    const page = await signedIn(browser);
    await page.goto(`/admin/productos?q=${TERM}`);
    await page.goto(`/admin/productos/${productId()}?q=${TERM}`);
    await page.getByTestId("product-toggle-button").click();
    await expect(page.getByTestId("product-done")).toHaveText(
      detail.doneProductHidden,
    );
    await page.getByTestId("product-toggle-button").click();
    await expect(page.getByTestId("product-done")).toHaveText(
      detail.doneProductUnhidden,
    );
    expect(productHidden()).toBe(false);

    for (const [where, logs] of [
      ["the isolated app", app.logs()],
      ["the Compose app", composeAppLogs()],
    ] as const) {
      expect(logs, `${where} answered`).toContain("Ready");
      for (const forbidden of [
        TERM,
        SLUG,
        ...DEMO_FEED_URLS,
        ...DEMO_SHOP_HOSTS,
        EMAIL,
        PASSWORD,
      ]) {
        expect(
          logs.includes(forbidden),
          `${where} output holds ${forbidden === PASSWORD ? "the password" : forbidden}`,
        ).toBe(false);
      }
    }
  });

  test("leaves the product and both offers not hidden", async () => {
    expect(productHidden()).toBe(false);
    expect(offerHidden(CHEAPER.shopName)).toBe(false);
    expect(offerHidden(DEARER.shopName)).toBe(false);
  });
});

// The file is serial, so a hard failure would skip the checks after it: the three parts below are
// one test with soft assertions on the names, so a red run reports every one of them.
test.describe("a toggle keeps its accessible name while it is saving", () => {
  // The hide POST is held (never answered) so the button stays pending, then aborted at the end:
  // nothing is written, so the database is as it was found.
  async function holdPosts(page: Page) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/admin/productos/**", async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
      ) {
        await gate;
        await route.abort();
      } else {
        await route.continue();
      }
    });
    return release;
  }

  const offerName = (shop: string): string =>
    detail.hideOfferName
      .replace("{shop}", shop)
      .replace("{id}", app.psqlScalar(`select o.feed_id ${offerWhere(shop)}`));

  test("offer and product toggles held pending keep their accessible names, and the text says they are saving", async ({
    browser,
  }) => {
    const page = await signedIn(browser);
    await page.goto(`/admin/productos/${productId()}`);
    await page.waitForLoadState("networkidle");
    const cheaper = offerRow(page, CHEAPER.shopName).getByTestId(
      "offer-toggle-button",
    );
    const dearer = offerRow(page, DEARER.shopName).getByTestId(
      "offer-toggle-button",
    );
    const product = page.getByTestId("product-toggle-button");

    // Idle names, so the pending checks below compare against something real.
    await expect(cheaper).toHaveAccessibleName(offerName(CHEAPER.shopName));
    await expect(dearer).toHaveAccessibleName(offerName(DEARER.shopName));
    await expect(product).toHaveAccessibleName(detail.hideProduct);
    expect(offerName(CHEAPER.shopName)).not.toBe(offerName(DEARER.shopName));

    const release = await holdPosts(page);
    try {
      // Two offer toggles pending at once.
      await cheaper.click();
      await dearer.click();
      await expect(cheaper).toHaveText(detail.saving);
      await expect(dearer).toHaveText(detail.saving);
      await expect
        .soft(cheaper, "offer toggle, pending: name")
        .toHaveAccessibleName(offerName(CHEAPER.shopName));
      await expect
        .soft(dearer, "second offer toggle, pending: name")
        .toHaveAccessibleName(offerName(DEARER.shopName));
      const [one, two] = await Promise.all([
        cheaper.getAttribute("aria-label"),
        dearer.getAttribute("aria-label"),
      ]);
      expect
        .soft(one, "two pending offer toggles have an aria-label")
        .not.toBeNull();
      expect
        .soft(one, "two pending offer toggles do not share a name")
        .not.toBe(two);

      // The product toggle pending, on its own (its name is its idle visible label).
      await product.click();
      await expect(product).toHaveText(detail.saving);
      await expect
        .soft(product, "product toggle, pending: name")
        .toHaveAccessibleName(detail.hideProduct);
    } finally {
      release();
    }
    expect(productHidden()).toBe(false);
    expect(offerHidden(CHEAPER.shopName)).toBe(false);
    expect(offerHidden(DEARER.shopName)).toBe(false);
  });
});
