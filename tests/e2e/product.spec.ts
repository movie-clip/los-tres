import { test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_CATEGORY_NAMES, DEMO_SHARED } from '../fixtures/demo';
import { FIXED_CATEGORY_TREE } from '../../src/db/category-tree';
import { DATE, aria, expectSmoke, PRICE, SHOPS } from '../support/smoke';

const path = (slug: string) => `/producto/${slug}`;

// #339 (0006 rule 11): the smoke test of the product page family.
test.describe('product smoke (#339)', () => {
  test('S3 smoke: the shared-EAN product answers 200, its main region matches and the console is clean', async ({
    page,
  }) => {
    const [first, second] = DEMO_SHARED.offers;
    await expectSmoke(
      page,
      path(DEMO_SHARED.slug),
      aria`
        - note: ${JSON.stringify(messages.DemoNotice.body)}
        - navigation "${messages.Product.breadcrumbLabel}":
          - list:
            - listitem:
              - link "${DEMO_CATEGORY_NAMES[FIXED_CATEGORY_TREE.slug]}":
                - /url: /categoria/${FIXED_CATEGORY_TREE.slug}
            - listitem:
              - link "${DEMO_CATEGORY_NAMES[DEMO_SHARED.categorySlug]}":
                - /url: /categoria/${DEMO_SHARED.categorySlug}
        - heading "${DEMO_SHARED.title}" [level=1]
        - term: ${messages.Product.partNumber}
        - definition: ${DEMO_SHARED.partNumber}
        - term: ${messages.Product.ean}
        - definition: "${DEMO_SHARED.ean}"
        - text: /${messages.Category.priceFrom} ${PRICE} ${SHOPS}/
        - paragraph: ${messages.Product.vatIncluded}
        - heading "${messages.Product.offersHeading}" [level=2]
        - list:
          - listitem:
            - text: /${first.shopName} ${messages.Product.bestPrice} ${PRICE} Actualizado el ${DATE}/
            - link "${messages.Product.goToShop.replace('{shopName}', first.shopName)}":
              - /url: /^\/go\/\d+$/
          - listitem:
            - text: /${second.shopName} ${PRICE} Actualizado el ${DATE}/
            - link "${messages.Product.goToShop.replace('{shopName}', second.shopName)}":
              - /url: /^\/go\/\d+$/
        - heading "${messages.Product.descriptionHeading}" [level=2]
      `,
    );
  });
});
