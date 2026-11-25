import { test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { DEMO_CATEGORY_NAMES } from '../fixtures/demo';
import { aria, expectSmoke, PRICE, PRODUCTS, SHOPS } from '../support/smoke';

// #339 (0006 rule 11): the smoke test of the category page family.
// The listing is matched as a subset: the first card's shape, not every card.
test.describe('category smoke (#339)', () => {
  test('S2 smoke: a category page answers 200, its main region matches and the console is clean', async ({ page }) => {
    const slug = 'filtros-de-aire';
    await expectSmoke(
      page,
      `/categoria/${slug}`,
      aria`
        - note: ${JSON.stringify(messages.DemoNotice.body)}
        - navigation "${messages.Product.breadcrumbLabel}":
          - list:
            - listitem:
              - link "${DEMO_CATEGORY_NAMES['mantenimiento-del-coche']}":
                - /url: /categoria/mantenimiento-del-coche
        - heading "${DEMO_CATEGORY_NAMES[slug]}" [level=1]
        - list "${messages.Category.brandGroupLabel}":
          - listitem:
            - link "${messages.Category.brandAll}":
              - /url: /categoria/${slug}
          - listitem:
            - link /\S+:\s${PRODUCTS}/:
              - /url: /^\/categoria\/${slug}\?marca=\S+$/
        - paragraph: /${PRODUCTS}/
        - combobox "${messages.Category.sortLabel}":
          - option "${messages.Category.sortPriceAsc}" [selected]
        - button "${messages.Category.sortSubmit}"
        - list:
          - listitem:
            - heading /DEMO Filtro de aire .+/ [level=2]:
              - link /DEMO Filtro de aire .+/:
                - /url: /^\/producto\/demo-filtro-de-aire-.+$/
            - text: /Ref\. \S+ (${messages.Category.priceFrom} )?${PRICE} ${SHOPS}/
      `,
    );
  });
});
