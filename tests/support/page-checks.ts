import { expect, type APIResponse, type Browser, type Page } from '@playwright/test';

// Shared browser-level checks for the public pages. The raw server HTML is
// parsed by `page.setContent` in a context with JavaScript off, so there is no
// HTML parser dependency and nothing a script could add.

/** Parses raw server HTML in a JavaScript-off context. Call `close()` when done. */
export async function openRawHtml(
  browser: Browser,
  html: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setContent(html);
  return { page, close: () => context.close() };
}

/** A public response never sets a cookie. */
export function expectNoSetCookie(response: APIResponse): void {
  expect(response.headers()['set-cookie']).toBeUndefined();
}

/** Every script `src` and every link `href` on the page is a same-origin path. */
export async function expectLocalScriptsAndLinks(page: Page): Promise<void> {
  const scriptSources = await page
    .locator('script[src]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src') ?? ''));
  for (const src of scriptSources) {
    expect(src.startsWith('/') && !src.startsWith('//')).toBe(true);
  }
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
  for (const href of hrefs) {
    expect(href.startsWith('/') && !href.startsWith('//')).toBe(true);
  }
}

/** No request left the app origin (data: and blob: do not count). */
export function expectNoForeignOrigin(requested: string[], origin: string): void {
  const foreign = requested.filter(
    (url) => !url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin,
  );
  expect(foreign).toEqual([]);
}
