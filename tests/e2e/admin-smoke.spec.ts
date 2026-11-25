import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_SHARED, DEMO_SHOPS } from '../fixtures/demo';
import { adminTest } from '../support/admin-e2e';
import { aria, expectSmoke } from '../support/smoke';

// #339 (0006 rule 11): the smoke tests of the four admin page families, one each. They only read, so they run
// in project `chromium` with the other read-only specs, before any serial spec writes the e2e database; what
// they see is the demo data of the run's fresh database. The three signed-in ones share one worker-scoped
// sign-in (`adminTest`, tests/support/admin-e2e.ts); the sign-in page itself is read anonymously.

const copy = messages.Admin;
/** Counts as the admin pages print them: whole numbers, with the thousands separator when there is one. */
const COUNT = String.raw`[\d.]+`;

test.describe('admin sign-in smoke (#339)', () => {
  test('S8 smoke: the sign-in page answers 200 to an anonymous visitor, its main region matches and the console is clean', async ({
    page,
  }) => {
    await expectSmoke(
      page,
      '/admin/acceso',
      aria`
        - heading "${copy.SignIn.heading}" [level=1]
        - text: ${copy.SignIn.emailLabel}
        - textbox "${copy.SignIn.emailLabel}"
        - text: ${copy.SignIn.passwordLabel}
        - textbox "${copy.SignIn.passwordLabel}"
        - button "${copy.SignIn.submit}"
      `,
    );
    // Nothing of the admin area is in the page for a visitor who has not signed in.
    await expect(page.getByTestId('admin-identity')).toHaveCount(0);
  });
});

adminTest.describe('admin pages smoke (#339)', () => {
  adminTest('S9 smoke: shops and feeds answers 200, its main region matches and the console is clean', async ({ page }) => {
    // The list is in name order: Dos comes before Uno.
    const dos = DEMO_SHOPS[1].name;
    const uno = DEMO_SHOPS[0].name;
    await expectSmoke(
      page,
      '/admin/tiendas',
      aria`
        - heading "${copy.Sources.heading}" [level=1]
        - paragraph: ${copy.Sources.intro}
        - paragraph: /${COUNT} tiendas? y ${COUNT} feeds?/
        - group "${copy.Sources.createGroupLabel}":
          - link "${copy.Sources.addShop}":
            - /url: /admin/tiendas/tienda/nueva
          - link "${copy.Sources.addFeed}":
            - /url: /admin/tiendas/feed/nuevo
        - list "${copy.Sources.listLabel}":
          - listitem:
            - heading "${dos}" [level=2]
            - text: /${copy.Sources.demoMark} ${copy.Sources.slugLabel}\s\S+ ${COUNT} feeds? · ${COUNT} ofertas?/
            - text: ${copy.Sources.shopApproved}
            - list:
              - listitem:
                - heading /${copy.Sources.feedTitle.replace('{id}', String.raw`\d+`)}/ [level=3]
                - text: ${copy.Sources.feedApproved}
          - listitem:
            - heading "${uno}" [level=2]
            - text: ${copy.Sources.shopApproved}
        - region "${copy.Sources.networksHeading}":
          - heading "${copy.Sources.networksHeading}" [level=2]
          - link "${copy.Sources.addNetwork}":
            - /url: /admin/tiendas/red/nueva
          - list "${copy.Sources.networksListLabel}":
            - listitem:
              - heading [level=3]
      `,
    );
  });

  adminTest('S10 smoke: products answers 200, its main region matches and the console is clean', async ({ page }) => {
    await expectSmoke(
      page,
      `/admin/productos?q=${DEMO_SHARED.ean}`,
      aria`
        - heading "${copy.Products.heading}" [level=1]
        - search "${copy.Products.searchFormLabel}":
          - textbox "${copy.Products.searchLabel}": "${DEMO_SHARED.ean}"
          - button "${copy.Products.searchButton}"
          - checkbox "${copy.Products.hiddenOnlyLabel}"
        - paragraph:
          - text: /${COUNT} productos? para «${DEMO_SHARED.ean}»/
          - link "${copy.Products.clearAll}":
            - /url: /admin/productos
        - list "${copy.Products.listLabel}":
          - listitem:
            - heading "${DEMO_SHARED.title}" [level=2]:
              - link "${DEMO_SHARED.title}":
                - /url: /^\/admin\/productos\/\d+\?q=${DEMO_SHARED.ean}$/
            - text: /${copy.Products.tagNotHidden} ${copy.Products.publicNowLabel}\s\S+ ${copy.Products.brandLabel}\s${DEMO_SHARED.brand} ${copy.Products.partNumberLabel}\s${DEMO_SHARED.partNumber} ${copy.Products.eanLabel}\s${DEMO_SHARED.ean} ${copy.Products.slugLabel}\s${DEMO_SHARED.slug}/
      `,
    );
  });

  adminTest('S11 smoke: feed categories answers 200, its main region matches and the console is clean', async ({
    page,
  }) => {
    await expectSmoke(
      page,
      '/admin/categorias',
      aria`
        - heading "${copy.Categories.heading}" [level=1]
        - paragraph: ${JSON.stringify(copy.Categories.intro)}
        - paragraph: ${JSON.stringify(copy.Categories.rulePublic)}
        - paragraph: ${JSON.stringify(copy.Categories.ruleRemove)}
        - paragraph: /${COUNT} feeds? · .+/
        - list "${copy.Categories.listLabel}":
          - listitem:
            - heading /^${copy.Categories.feedHeading.replace('{id}', String.raw`\d+`).replace('{shop}', '.+')}$/ [level=2]
            - list /^${copy.Categories.rowListLabelReviewed.replace('{feed}', '.+')}$/:
              - listitem:
                - strong: /\S+/
                - combobox /^${copy.Categories.selectLabel} .+/
                - button /^${copy.Categories.changeName.replace('{category}', '.+')}$/
      `,
    );
  });
});
