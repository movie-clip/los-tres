import { expect, test } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { expectNoForeignOrigin } from '../support/page-checks';

// Journey J13 (#398): a first visit follows a dark system setting, a press of the switch changes the scheme and
// remembers it in this browser, and a reload keeps the choice over the system setting. It asserts state (the
// root attribute, the stored value, the pressed name, the cookie jar, what left the browser), never pixels or
// geometry (0006 rule 11); the colour sets, the script's cases and the seams are unit tests (theme.test.ts,
// styles.test.ts, seams.test.ts). No sleep and no retry; the pressed state appearing is the hydration signal.

// The stored contract, typed out here as the independent oracle for the unit tests' constants.
const KEY = 'tema';
const LIGHT = 'claro';

const NAME = messages.Theme.toggleLabel;

test.use({ colorScheme: 'dark' });

declare global {
  interface Window {
    /** The `data-theme` of html at the moment body first existed, or null when the attribute was absent. */
    __schemeAtBody?: string | null;
  }
}

test('J13: a first visit on a dark system is dark, a press makes it light and remembers it, a reload keeps it', async ({
  page,
  context,
  baseURL,
}) => {
  const requested: string[] = [];
  const sent: string[] = [];
  const headerNames: string[] = [];
  const problems: string[] = [];
  page.on('request', (request) => {
    requested.push(request.url());
    sent.push(new URL(request.url()).search, request.postData() ?? '', ...Object.values(request.headers()));
    headerNames.push(...Object.keys(request.headers()));
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });

  // The scheme the page had when the parser first made a body: the head script must already have run, so no
  // frame of the body can have been drawn in the wrong scheme.
  await page.addInitScript(() => {
    const note = (): boolean => {
      if (document.body === null) return false;
      window.__schemeAtBody = document.documentElement.getAttribute('data-theme');
      return true;
    };
    if (note()) return;
    const observer = new MutationObserver(() => {
      if (note()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });

  const switchWhen = (pressed: boolean) => page.getByRole('button', { name: NAME, pressed, exact: true });
  const schemeAtBody = () => page.evaluate(() => window.__schemeAtBody);
  const stored = () => page.evaluate((key) => window.localStorage.getItem(key), KEY);

  // First visit, dark system, nothing stored: dark at first paint.
  await page.goto('/');
  expect(await schemeAtBody()).toBe('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await stored()).toBeNull();

  // The switch reads "pressed" once hydrated; pressing it makes the page light and remembers it.
  await expect(switchWhen(true)).toBeVisible();
  await switchWhen(true).click();
  await expect(switchWhen(false)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await stored()).toBe(LIGHT);
  expect(await context.cookies()).toEqual([]);

  // A reload: the stored choice beats the dark system setting at first paint.
  await page.reload();
  expect(await schemeAtBody()).toBe('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(switchWhen(false)).toBeVisible();
  expect(await stored()).toBe(LIGHT);
  expect(await context.cookies()).toEqual([]);

  // Nothing about the choice left the browser: no request carried the key or a stored word, none named a
  // scheme header, and nothing went to another origin.
  expect(sent.filter((value) => /tema|claro|oscuro/i.test(value))).toEqual([]);
  expect(headerNames.filter((name) => /color-scheme/i.test(name))).toEqual([]);
  expectNoForeignOrigin(requested, new URL(baseURL ?? '').origin);
  expect(problems).toEqual([]);
});
