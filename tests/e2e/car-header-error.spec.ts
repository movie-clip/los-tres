import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { origin } from '../support/e2e-stack';

// US-5.7 (T5.7.3) against the e2e `app-no-db` service: the car control in the header of the public error
// page (ACs 1 and 5). The service is the same image as `app` with a database nobody listens on, started by
// the global setup (#363), so this spec starts nothing; the rest of the header specs are in car-header.spec.ts.

test.describe('the error page carries the control (AC 1, AC 5)', () => {
  // The same service as search-privacy.spec.ts: a server whose database is unreachable, so a search ends
  // on the public error page. The header around it must still draw the control, in the no-car state, and
  // must not raise an error of its own.
  test('a failing page shows the generic error and, in the header, the no-car action', async ({ browser }) => {
    const failing = origin('app-no-db');
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(`${failing}/buscar?q=filtro`);
    expect(response?.status()).toBe(500);
    await expect(page.getByTestId('public-error')).toBeVisible();
    await expect(page.getByTestId('car-control')).toBeVisible();
    await expect(page.getByTestId('car-select')).toHaveText(messages.Car.select);
    await expect(page.getByTestId('car-label')).toHaveCount(0);
    await expect(page.getByTestId('car-notice')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(await context.cookies()).toEqual([]);
    await context.close();
  });
});
