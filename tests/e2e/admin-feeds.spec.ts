import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { adminTest } from '../support/admin-e2e';
import { psql } from '../support/e2e-stack';
import { expectNoSetCookie, stripScripts } from '../support/page-checks';

// US-3.1 against the e2e stack, J9 of 0006 rule 12: the admin registers a network, a shop and a feed through the
// forms, and approves them (ACs 37 to 43). The pages, the refusals and the writers are integration tests
// (admin-source-pages.test.ts, admin-source-actions.test.ts, admin-source-writers.test.ts).
//
// This spec writes to the e2e database, so it is bounded and runs in the `serial` project. The one feed and the
// one shop it approves are disabled again by the journey itself and, as a safety net, by `releaseRows()` before
// and after the run, so an approved e2e feed with an https address never reaches an `import-feeds`. There is no
// delete verb. It signs in as the e2e admin the global setup created.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const copy = messages.Admin.Sources;
const form = messages.Admin.Form;

/** Un-approves everything this spec may have approved. */
function releaseRows(): void {
  psql("update feeds set is_approved = false where url like 'https://e2e-feeds-%'");
  psql("update shops set is_approved = false where slug like 'e2e-tienda-%'");
}

test.beforeAll(() => {
  releaseRows();
});
test.afterAll(() => {
  releaseRows();
});

const SOURCES = '/admin/tiendas';

// #339 (0006 rule 12): journey J9, an admin registers a network, a shop and an https feed through the forms and
// approves them, and nothing of it reaches the public site. It signs in once per worker (`adminTest`), uses rows
// of its own (a fresh e2e database has none, and `releaseRows()` above matches their slug and host patterns), and
// ends with the feed and the shop disabled again, so nothing is left approved for the next `import-feeds`.
adminTest.describe('registering and approving a feed journey (#339)', () => {
  const JOURNEY = {
    network: { name: 'Red e2e viaje', slug: 'e2e-red-viaje' },
    shop: { name: 'Tienda e2e viaje', slug: 'e2e-tienda-viaje' },
    host: 'e2e-feeds-viaje.example',
    url: 'https://e2e-feeds-viaje.example/privado/KEY-E2E-VIAJE/viaje-datos.csv?token=TOKEN-E2E-VIAJE',
  };

  adminTest('J9: network, shop and feed through the forms; both approved and disabled again; the public site unchanged', async ({
    page,
    publicRequest: request,
  }) => {
    const sitemapBefore = await (await request.get('/sitemap.xml')).text();
    const productBefore = stripScripts(await (await request.get('/producto/demo-filtro-de-aceite-oc-1234')).text());

    // The network, from the toolbar.
    await page.goto(SOURCES);
    await page.getByRole('link', { name: copy.addNetwork, exact: true }).click();
    await page.getByLabel(form.nameLabel, { exact: true }).fill(JOURNEY.network.name);
    await page.getByLabel(form.slugLabel, { exact: true }).fill(JOURNEY.network.slug);
    await page.getByRole('button', { name: form.Network.submitNew, exact: true }).click();
    await expect(page.getByText(copy.noticeNetworkCreated, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: JOURNEY.network.name, exact: true })).toBeVisible();

    // The shop: it starts not approved and with no feed.
    await page.getByRole('link', { name: copy.addShop, exact: true }).click();
    await page.getByLabel(form.nameLabel, { exact: true }).fill(JOURNEY.shop.name);
    await page.getByLabel(form.slugLabel, { exact: true }).fill(JOURNEY.shop.slug);
    await page.getByRole('button', { name: form.Shop.submitNew, exact: true }).click();
    await expect(page.getByText(copy.noticeShopCreated, { exact: true })).toBeVisible();
    const shop = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { level: 2, name: JOURNEY.shop.name, exact: true }),
    });
    await expect(shop.getByText(copy.shopNotApproved, { exact: true })).toBeVisible();
    await expect(shop.getByText(copy.shopNoFeeds, { exact: true })).toBeVisible();

    // The feed, from the shop's own link: it starts not approved, and the page shows the host and nothing else of the address.
    await shop.getByRole('link', { name: copy.addFeedName.replace('{shop}', JOURNEY.shop.name), exact: true }).click();
    await page.getByLabel(form.Feed.networkLabel, { exact: true }).selectOption({ label: JOURNEY.network.name });
    await page.getByLabel(form.Feed.urlLabelNew, { exact: true }).fill(JOURNEY.url);
    await page.getByRole('button', { name: form.Feed.submitNew, exact: true }).click();
    await expect(page.getByText(copy.noticeFeedCreated, { exact: true })).toBeVisible();
    const feedHeading = shop.getByRole('heading', { level: 3 });
    const feedId = /\d+/.exec(await feedHeading.innerText())?.[0] ?? '';
    expect(feedId).not.toBe('');
    await expect(shop.getByText(copy.feedNotApproved, { exact: true })).toBeVisible();
    await expect(shop).toContainText(JOURNEY.host);
    // A fresh load of the list: what Next sent for the form page is not part of it.
    await page.goto(SOURCES);
    const content = await page.content();
    for (const secret of ['KEY-E2E-VIAJE', 'TOKEN-E2E-VIAJE', '/privado/', 'viaje-datos.csv']) expect(content, secret).not.toContain(secret);

    // Two separate approvals, each one a press that says what it saved.
    await shop.getByRole('button', { name: copy.shopApproveName.replace('{shop}', JOURNEY.shop.name), exact: true }).click();
    await expect(shop.getByText(copy.doneShopApproved, { exact: true })).toBeVisible();
    await shop
      .getByRole('button', {
        name: copy.feedApproveName.replace('{id}', feedId).replace('{shop}', JOURNEY.shop.name),
        exact: true,
      })
      .click();
    await expect(shop.getByText(copy.doneFeedApproved, { exact: true })).toBeVisible();
    await expect(shop.getByText(copy.feedApproved, { exact: true })).toBeVisible();

    // Approving publishes nothing by itself: no import has run, so the public pages are as they were.
    const sitemap = await request.get('/sitemap.xml');
    expectNoSetCookie(sitemap);
    expect(await sitemap.text()).toBe(sitemapBefore);
    expect(stripScripts(await (await request.get('/producto/demo-filtro-de-aceite-oc-1234')).text())).toBe(productBefore);
    expect(await (await request.get(`/buscar?q=${JOURNEY.shop.slug}`)).text()).not.toContain(JOURNEY.shop.name);

    // Disable the shop, then the feed, each behind its confirmation: nothing stays approved. The shop goes first on
    // purpose (#384): its stored result ends the "Feed aprobado" line its feed row still shows, in the same update
    // that shows the shop's own line, and the feed row says what is true now through its own pause note. This is the
    // only proof on the real action and the real revalidation; the rule itself is unit/source-row-feedback.test.ts.
    await shop.getByRole('button', { name: copy.shopDisableName.replace('{shop}', JOURNEY.shop.name), exact: true }).click();
    await shop.getByRole('button', { name: copy.confirmShopYes, exact: true }).click();
    await expect(shop.getByText(copy.doneShopDisabled, { exact: true })).toBeVisible();
    await expect(shop.getByText(copy.doneFeedApproved, { exact: true })).toHaveCount(0);
    await expect(shop.getByText(copy.feedNotePaused, { exact: true })).toBeVisible();
    await shop
      .getByRole('button', {
        name: copy.feedDisableName.replace('{id}', feedId).replace('{shop}', JOURNEY.shop.name),
        exact: true,
      })
      .click();
    await shop.getByRole('button', { name: copy.confirmFeedYes, exact: true }).click();
    // The feed's own answer shows as ever, and a feed press does not end the shop's line.
    await expect(shop.getByText(copy.doneFeedDisabled, { exact: true })).toBeVisible();
    await expect(shop.getByText(copy.doneShopDisabled, { exact: true })).toBeVisible();
    await expect(shop.getByText(copy.shopNotApproved, { exact: true })).toBeVisible();
  });
});
