import { expect, test } from '@playwright/test';

import { CAR, OTHER_MAKE, UNKNOWN_SLUG, carName } from '../support/car';
import { stripScripts } from '../support/page-checks';

// US-5.7 (T5.7.3, L2t) against the Compose stack, B3 of #339: the forged request headers (the proxy deletes
// x-car-slug and x-car-path before it sets them). The proxy runs on the built server; the stripping logic is
// unit/car-request.test.ts, and the car control in its states is unit/car-control.test.ts.

/** The path with `coche` added last, whatever the path already carries. */
const withCoche = (path: string, slug: string): string =>
  `${path}${path.includes('?') ? '&' : '?'}coche=${slug}`;

test.describe('forged car request headers are never believed (the proxy owns them)', () => {
  const FORGED_PATH = '/zz-forged-path-marker';

  test('x-car-slug and x-car-path with no coche render no car, and a forged header cannot swap the car named in the URL nor turn a bad one into a good one', async ({
    request,
  }) => {
    const response = await request.get('/', {
      headers: { 'x-car-slug': CAR.slug, 'x-car-path': FORGED_PATH },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['set-cookie']).toBeUndefined();
    const html = stripScripts(await response.text());
    expect(html).toContain('data-testid="car-select"');
    expect(html).not.toContain('data-testid="car-label"');
    expect(html).not.toContain('data-testid="car-notice"');
    expect(html).not.toContain(carName(CAR));
    // The forged path is not what the no-script links return to.
    expect(html).not.toContain('zz-forged-path-marker');

    const swapped = await request.get(withCoche('/', CAR.slug), {
      headers: { 'x-car-slug': OTHER_MAKE.slug, 'x-car-path': FORGED_PATH },
    });
    const swappedHtml = stripScripts(await swapped.text());
    expect(swappedHtml).toContain(carName(CAR));
    expect(swappedHtml).not.toContain(carName(OTHER_MAKE));
    expect(swappedHtml).not.toContain('zz-forged-path-marker');

    const unknown = await request.get(withCoche('/', UNKNOWN_SLUG), {
      headers: { 'x-car-slug': CAR.slug },
    });
    const unknownHtml = stripScripts(await unknown.text());
    expect(unknownHtml).toContain('data-testid="car-notice"');
    expect(unknownHtml).not.toContain('data-testid="car-label"');
  });
});
