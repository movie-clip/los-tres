import { test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { loadEnv } from '../support/env';
import { aria, expectSmoke } from '../support/smoke';

loadEnv();
const siteName = (process.env.SITE_NAME ?? '').trim();

const siteTitle = (message: string) => message.replace('{siteName}', siteName);

// #339 (0006 rule 11): the smoke test of the legal page family. It reads
// the funding page: the other two answer 500 while the owner identity is blank, which is the case in CI.
test.describe('legal pages smoke (#339)', () => {
  test('S6 smoke: the funding page answers 200, its main region matches and the console is clean', async ({ page }) => {
    await expectSmoke(
      page,
      '/como-nos-financiamos',
      aria`
        - heading "${siteTitle(messages.Funding.heading)}" [level=1]
        - paragraph: ${JSON.stringify(siteTitle(messages.Funding.intro))}
        - list:
          - listitem:
            - strong: /\S+/
          - listitem:
            - strong: /\S+/
          - listitem:
            - strong: /\S+/
      `,
    );
  });
});
