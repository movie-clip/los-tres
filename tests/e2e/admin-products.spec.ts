import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED } from '../fixtures/demo';
import { adminTest } from '../support/admin-e2e';
import { psql } from '../support/e2e-stack';
import { expectServerRenderedNotFound } from '../support/page-checks';

// US-2.4, J11 of 0006 rule 12: from sign-in to a product hidden and unhidden through the screens, with what each
// does to the public page, `/go` and search. The screens, the writers and the sweep of every public reader are
// integration tests (admin-product-pages.test.ts, hide-public-sweep.test.ts). Desktop width only: admin screens
// are not checked at phone width.
//
// The demo product is hidden for real, on the e2e stack's own `app` and database (#363). Hiding it would change
// the counts and pages that the other specs read in parallel, so the spec runs in the `serial` project, after
// them, and leaves the product and both offers not hidden when it ends (`beforeAll` and `afterAll` put them back
// even after a failure). It signs in as the e2e admin the global setup created.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const copy = messages.Admin.Products;
const detail = messages.Admin.Products.Detail;
const siteName = (process.env.SITE_NAME ?? '').trim();

const SLUG = DEMO_SHARED.slug;
const TITLE = DEMO_SHARED.title;
const TERM = DEMO_SHARED.ean; // an exact EAN finds this product alone, in the admin list and in the public search

/** Leaves the demo product and its offers not hidden, whatever a failed test left. */
function restoreHidden(): void {
  psql(`update products set is_hidden = false where slug = '${SLUG}'`);
  psql(`update offers set is_hidden = false where product_id in (select id from products where slug = '${SLUG}')`);
}

test.beforeAll(restoreHidden);
test.afterAll(restoreHidden);

// #339 (0006 rule 12): journey J11, an admin hides and unhides a product and the public page follows. It signs in once
// per worker (`adminTest`) and reads the public site through the `publicRequest` fixture, which holds no admin
// session. The file's `beforeAll` and `afterAll` leave the product not hidden even if
// this test fails half way.
adminTest.describe('hide and unhide journey (#339)', () => {
  adminTest('J11: find the product by its EAN, hide it and the public site drops it, unhide it and the site shows it again', async ({
    page,
    publicRequest: request,
  }) => {
    /** The public answers for the product page, its two offers' /go links and a search for the EAN. */
    async function publicAnswers(goPaths: string[]) {
      const product = await request.get(`/producto/${SLUG}`, { maxRedirects: 0 });
      const go: number[] = [];
      for (const path of goPaths) go.push((await request.get(path, { maxRedirects: 0 })).status());
      const search = await request.get(`/buscar?q=${TERM}`);
      return { status: product.status(), html: await product.text(), go, search: await search.text() };
    }

    // The baseline: public, with a /go link per offer (the ids are read from the page, they differ between runs).
    const before = await request.get(`/producto/${SLUG}`);
    expect(before.status()).toBe(200);
    const goPaths = [...(await before.text()).matchAll(/href="(\/go\/\d+)"/g)].map((match) => match[1]);
    expect(goPaths).toHaveLength(DEMO_SHARED.offers.length);
    const baseline = await publicAnswers(goPaths);
    expect(baseline.status).toBe(200);
    expect(baseline.go).toEqual([302, 302]);
    expect(baseline.search).toContain(TITLE);

    // Find it from the list by its EAN: one row, not hidden, on the site now.
    await page.goto('/admin/productos');
    await page.getByRole('textbox', { name: copy.searchLabel, exact: true }).fill(TERM);
    await page.getByRole('button', { name: copy.searchButton, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]q=${TERM}(&|$)`));
    const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: TITLE, exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByText(copy.tagNotHidden, { exact: true })).toBeVisible();
    await row.getByRole('link', { name: TITLE, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Hide it: the screen says so in words, and the public page, /go and search answer as if it did not exist.
    await page.getByRole('button', { name: detail.hideProduct, exact: true }).click();
    await expect(page.getByText(detail.doneProductHidden, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: detail.unhideProduct, exact: true })).toBeVisible();
    const hidden = await publicAnswers(goPaths);
    expect(hidden.status).toBe(404);
    expectServerRenderedNotFound(hidden.html, siteName);
    expect(hidden.go).toEqual([404, 404]);
    expect(hidden.search).not.toContain(TITLE);

    // Unhide it: the site shows it again with both offers, and the screen never says it was published.
    await page.getByRole('button', { name: detail.unhideProduct, exact: true }).click();
    await expect(page.getByText(detail.doneProductUnhidden, { exact: true })).toBeVisible();
    await expect(page.getByText(detail.doneProductUnhidden, { exact: true })).not.toContainText(/aparece|publica|visible en el sitio/i);
    const shown = await publicAnswers(goPaths);
    expect(shown.status).toBe(200);
    expect(shown.go).toEqual([302, 302]);
    expect(shown.search).toContain(TITLE);
  });
});
