import { expect, type APIResponse, type Browser, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';

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

/** No request left the app origin (data: and blob: do not count). */
export function expectNoForeignOrigin(requested: string[], origin: string): void {
  const foreign = requested.filter(
    (url) => !url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin,
  );
  expect(foreign).toEqual([]);
}

/** The server HTML without its `<script>` blocks: Next puts the whole flight payload in them, so a text check on the raw body can pass on data no visitor sees. */
export const stripScripts = (html: string): string => html.replace(/<script\b[\s\S]*?<\/script>/gi, '');

const countOf = (html: string, pattern: RegExp): number => (html.match(pattern) ?? []).length;

/**
 * S11.7: the nested 404 (a missing product, a missing category, a page or brand past the last) is a
 * full server-rendered page, the same as an unmatched URL. Reads the script-stripped body only, so it
 * fails on Next's empty error shell (`html#__next_error__`, no header, main, h1 or footer).
 */
export function expectServerRenderedNotFound(html: string, siteName: string, label = ''): void {
  const body = stripScripts(html);
  const say = (what: string) => `${label} ${what}`.trim();
  expect(body, say('is not the framework error shell')).not.toContain('__next_error__');
  expect(body, say('html lang')).toMatch(/<html\b[^>]*\blang="es-ES"/);
  expect(countOf(body, /<link\b[^>]*rel="stylesheet"/g), say('stylesheet links')).toBeGreaterThanOrEqual(1);
  expect(countOf(body, /<header\b/g), say('header count')).toBe(1);
  expect(countOf(body, /<main\b/g), say('main count')).toBe(1);
  expect(countOf(body, /<footer\b/g), say('footer count')).toBe(1);
  const headings = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => match[1].replace(/<[^>]*>/g, '').trim());
  expect(headings, say('h1')).toEqual([messages.NotFound.heading]);
  const anchors = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    attributes: match[1],
    text: match[2].replace(/<[^>]*>/g, '').trim(),
  }));
  const home = anchors.filter((anchor) => anchor.text === messages.NotFound.backHome);
  expect(home.length, say('back-home link')).toBeGreaterThanOrEqual(1);
  expect(home.some((anchor) => /\bhref="\/"/.test(anchor.attributes)), say('back-home href')).toBe(true);
  expect(body, say('title')).toContain(
    `<title>${messages.NotFound.metaTitle.replace('{siteName}', siteName)}</title>`,
  );
  expect(body, say('robots')).toMatch(/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/);
}
