import { expect, type APIResponse, type Browser, type Locator, type Page } from '@playwright/test';

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

/**
 * Every script `src` and every link `href` on the page is a same-origin path.
 * `allowHrefs` names the exceptions by exact string (the legal pages allow only
 * the contact `mailto:` and the AEPD site); a near miss such as another host or
 * a different path on the same host still fails.
 */
export async function expectLocalScriptsAndLinks(
  page: Page,
  options: { allowHrefs?: string[] } = {},
): Promise<void> {
  const allowed = new Set(options.allowHrefs ?? []);
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
    expect(allowed.has(href) || (href.startsWith('/') && !href.startsWith('//'))).toBe(true);
  }
}

/** The footer every page carries (S9.3): three plain links, no heading, no paragraph. */
export async function expectLegalFooter(page: Page): Promise<void> {
  const footer = page.getByRole('contentinfo');
  await expect(footer).toHaveCount(1);
  const links = footer.locator('a');
  expect(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))).toEqual([
    '/aviso-legal',
    '/privacidad',
    '/como-nos-financiamos',
  ]);
  expect((await links.allTextContents()).map((label) => label.trim())).toEqual([
    messages.Footer.legalNotice,
    messages.Footer.privacy,
    messages.Footer.funding,
  ]);
  await expect(footer.locator('p, h1, h2, h3, h4, h5, h6')).toHaveCount(0);
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

/** Resolves any CSS colour (a `var(--token)` too) to the `rgb(...)` string a computed style reports. */
export async function cssColour(page: Page, value: string): Promise<string> {
  return page.evaluate((input) => {
    const probe = document.createElement('span');
    probe.style.color = input;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

/** The computed style a pressed-state check reads, plus the box (a press must not move it). */
export type StyleSnapshot = {
  background: string;
  border: string;
  colour: string;
  decoration: string;
  thickness: string;
  radius: string;
  width: number;
  height: number;
};

export const snapshotOf = (locator: Locator): Promise<StyleSnapshot> =>
  locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      colour: style.color,
      decoration: style.textDecorationLine,
      thickness: style.textDecorationThickness,
      radius: style.borderTopLeftRadius,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
    };
  });

/**
 * Holds the primary button down on `target` (never released on it, so nothing is clicked or
 * toggled), runs `read`, then lets go away from the target. Chromium applies `:active` for as
 * long as the button is down.
 */
export async function whilePressed<T>(page: Page, target: Locator, read: () => Promise<T>): Promise<T> {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    return await read();
  } finally {
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
}
