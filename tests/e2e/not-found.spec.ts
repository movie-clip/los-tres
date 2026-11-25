import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { loadEnv } from '../support/env';
import { expectNoSetCookie, expectServerRenderedNotFound } from '../support/page-checks';
import { aria, expectSmoke } from '../support/smoke';

loadEnv();
const siteName = (process.env.SITE_NAME ?? '').trim();

// S11.7 (B4 of #339): the nested 404 is a full server-rendered page, not only a flight payload. src/proxy.ts
// rewrites a missing product or category to the root not-found, so the served body is checked with the scripts
// stripped. One nested URL stands for the rewrite: the decision for every missing shape is
// integration/missing-page.test.ts, and the built server is what this test needs.
test.describe('nested 404 server HTML (S11.7)', () => {
  const url = '/producto/no-existe';

  test(`${url}: the script-stripped body is the full 404 page, status 404, no cookie`, async ({ request }) => {
    const served = await request.get(url);
    expect(served.status()).toBe(404);
    expectNoSetCookie(served);
    expectServerRenderedNotFound(await served.text(), siteName, url);
  });
});

// #339 (0006 rule 11): the smoke test of the 404 page family. The one
// console line it lets through is the browser's own report of the document's 404 status.
test.describe('404 smoke (#339)', () => {
  test('S7 smoke: an unknown path answers 404, its main region matches and the console has no other error', async ({
    page,
  }) => {
    await expectSmoke(
      page,
      '/no-existe',
      aria`
        - heading "${messages.NotFound.heading}" [level=1]
        - paragraph: ${messages.NotFound.body}
        - paragraph:
          - link "${messages.NotFound.backHome}":
            - /url: /
      `,
      { status: 404, ignoreOwnStatusLine: true },
    );
  });
});
