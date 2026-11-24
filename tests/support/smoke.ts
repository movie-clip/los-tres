import { expect, type ConsoleMessage, type Page } from '@playwright/test';

// Smoke tests, one per page family (decision 0006 rule 11, #339). Each one does three things: the page
// answers the right status, the ARIA snapshot of its `main` region matches an inline template, and the
// browser reports no console error and no page error. The template is a string in the spec, never a snapshot
// file, and no script updates it. A template names the structure a visitor or admin would lose (headings,
// landmarks, controls, links, the rows a page is for) and uses the patterns below for values that change
// between runs: prices, counts and dates. A template matches as a subset of the region, in order, so it
// does not pin a list's every row.

/** Tags a template so a backslash stays a backslash: aria`- text: /\d+ tiendas/`. */
export const aria = String.raw;

/** A price as the site writes it: `11,49 €` (the space before the euro sign may be U+00A0). Regex source, no slashes. */
export const PRICE = String.raw`\d+,\d{2}\s€`;
/** A count of products as the site writes it: `12 productos`, `1 producto`. */
export const PRODUCTS = String.raw`\d+ productos?`;
/** A count of shops: `4 tiendas`, `1 tienda`. */
export const SHOPS = String.raw`\d+ tiendas?`;
/** A medium Spanish date: `24 nov 2026`, `4 sept 2026`. */
export const DATE = String.raw`\d{1,2} \S+ \d{4}`;

export type SmokeOptions = {
  /** The status the page must answer. Default 200. */
  status?: number;
  /**
   * Ignore the one console line Chromium writes for the document's own non-2xx status
   * ("Failed to load resource: the server responded with a status of 404"), matched by the page's own URL.
   * Only the 404 smoke sets it; every other console error fails the test.
   */
  ignoreOwnStatusLine?: boolean;
};

/**
 * Opens `path`, checks the status, matches the ARIA snapshot of `getByRole('main')` against `template`, waits for
 * hydration, and fails on any console error or page error seen from the first request on.
 */
export async function expectSmoke(
  page: Page,
  path: string,
  template: string,
  options: SmokeOptions = {},
): Promise<void> {
  const problems: string[] = [];
  const documentPath = new URL(path, 'http://page.invalid').pathname;
  // The line is written while the navigation is still pending, so the document is matched by its path.
  const ownStatusLine = (message: ConsoleMessage): boolean =>
    options.ignoreOwnStatusLine === true &&
    new URL(message.location().url || 'http://none.invalid').pathname === documentPath &&
    /^Failed to load resource: the server responded with a status of \d{3}\b/.test(message.text());
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (ownStatusLine(message)) return;
    problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));

  const response = await page.goto(path);
  expect(response?.status(), `${path} status`).toBe(options.status ?? 200);
  await expect(page.getByRole('main'), `${path} main region`).toMatchAriaSnapshot(template);
  await page.waitForLoadState('networkidle');
  expect(problems, `${path} console and page errors`).toEqual([]);
}
