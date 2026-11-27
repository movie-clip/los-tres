import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SearchFormProps } from '@/components/SearchForm';
import { SiteHeader } from '@/components/SiteHeader';

// The header takes finished strings. These cover the box being mounted, its
// shape, and the rule that hides it where the page owns a search form.

const search: SearchFormProps = {
  variant: 'header',
  action: '/buscar',
  formLabel: 'Buscar',
  fieldLabel: 'Buscar un producto',
  button: 'Buscar',
  hint: null,
  value: null,
};

const render = (props: { siteName?: string; search: SearchFormProps | null }) =>
  renderToStaticMarkup(createElement(SiteHeader, { siteName: 'Sitio de prueba', ...props }));

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('SiteHeader search box', () => {
  it('keeps the site-name link and mounts a GET search form to /buscar after it', () => {
    const html = render({ search });
    expect(html).toMatch(/<a [^>]*data-testid="site-header-link"[^>]*href="\/"[^>]*>Sitio de prueba</);
    expect(html).toMatch(/<form [^>]*role="search"/);
    expect(html).toMatch(/<form [^>]*method="get"/);
    expect(html).toMatch(/<form [^>]*action="\/buscar"/);
    expect(html).toMatch(/<input [^>]*name="q"/);
    expect(html.indexOf('site-header-link')).toBeLessThan(html.indexOf('header-search"'));
  });

  it('renders the header presentation: named field, no visible label, no hint, no value, no marker', () => {
    const html = render({ search });
    expect(html).toMatch(/<form [^>]*data-testid="header-search"/);
    expect(html).toMatch(/<input [^>]*aria-label="Buscar un producto"/);
    expect(html).toMatch(/<button [^>]*data-testid="header-search-button"[^>]*>Buscar</);
    expect(html).not.toContain('<label');
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toMatch(/<input [^>]*(value|placeholder)=/);
    expect(html).not.toContain('data-search-page');
  });

  it('renders the header placeholder only when one is passed, and keeps the accessible name', () => {
    const html = render({ search: { ...search, placeholder: 'Buscar' } });
    const input = html.match(/<input [^>]*name="q"[^>]*>/)?.[0] ?? '';
    expect(input).toMatch(/\splaceholder="Buscar"/);
    expect(input).toMatch(/aria-label="Buscar un producto"/);
    expect(input).not.toMatch(/\svalue=/);
    for (const empty of ['', null]) {
      const bare = render({ search: { ...search, placeholder: empty } });
      expect(bare.match(/<input [^>]*name="q"[^>]*>/)?.[0] ?? '').not.toMatch(/placeholder=/);
    }
  });

  it('renders the site name alone when no search is given', () => {
    const html = render({ search: null });
    expect(html).toContain('data-testid="site-header-link"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
  });
});

describe('SiteHeader hiding rule and wiring', () => {
  it('hides the box with a rule keyed on the page form marker, in the header module', () => {
    const css = read('src/components/SiteHeader.module.css');
    expect(css).toMatch(/:global\(body:has\(\[data-search-page\]\)\)\s+\.search\s*\{\s*display:\s*none;/);
  });

  it('lets the header row wrap below 40rem and holds one row from 40rem', () => {
    const css = read('src/components/SiteHeader.module.css');
    expect(css).toMatch(/\.inner\s*\{[^}]*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/@media \(min-width: 40rem\)\s*\{[^}]*\.inner\s*\{[^}]*flex-wrap:\s*nowrap;/);
  });

  it('has the public chrome build the header presentation from the Search messages and SEARCH_PATH', () => {
    const chrome = read('src/app/PublicChrome.tsx');
    expect(chrome).toContain("variant: 'header'");
    expect(chrome).toContain('action: SEARCH_PATH');
    expect(chrome).toContain("getTranslations('Search')");
    expect(chrome).toContain('hint: null');
    expect(chrome).toContain('value: null');
  });

  it('leaves the admin area without the box', () => {
    const header = read('src/components/admin/AdminHeader.tsx');
    expect(header).not.toMatch(/SearchForm|SiteHeader/);
  });
});

// #398: the switch joins row 1. These pin the CSS rules the layout and the no-script path rest on; the header's
// markup order is tests/unit/theme.test.ts and the one browser journey is J13 (tests/e2e/theme.spec.ts).
describe('SiteHeader theme switch rules (#398)', () => {
  it('hides the switch until the head script has set data-theme on html, and shows it only then', () => {
    const css = read('src/components/ThemeSwitch.module.css');
    expect(css).toMatch(/^\.switch\s*\{\s*display:\s*none;/m);
    expect(css).toMatch(/:global\(html\[data-theme\]\)\s+\.switch\s*\{[^}]*display:\s*(?!none)[a-z-]+;/);
  });

  it('keys the switch on the attribute alone, never on a media query, so no script shows no switch', () => {
    expect(read('src/components/ThemeSwitch.module.css')).not.toMatch(/@media/);
  });

  it('sizes the switch by the tap-target token, width and height', () => {
    const css = read('src/components/ThemeSwitch.module.css');
    expect(css).toMatch(/:global\(html\[data-theme\]\)\s+\.switch\s*\{[^}]*width:\s*var\(--tap-target\);/);
    expect(css).toMatch(/:global\(html\[data-theme\]\)\s+\.switch\s*\{[^}]*height:\s*var\(--tap-target\);/);
  });

  it('gives the phone search box a 10rem basis and keeps 14rem from 40rem', () => {
    const css = read('src/components/SiteHeader.module.css');
    expect(css).toMatch(/\.search\s*\{[^}]*flex:\s*1\s+1\s+10rem;/);
    expect(css).toMatch(/@media \(min-width: 40rem\)\s*\{[\s\S]*?\.search\s*\{[^}]*flex-basis:\s*14rem;/);
  });

  it('places the trailing group against the right edge as one unit, and lets the car control size itself inside it', () => {
    const css = read('src/components/SiteHeader.module.css');
    expect(css).toMatch(/\.trailing\s*\{[^}]*flex:\s*none;[^}]*margin-left:\s*auto;/);
    expect(css).toMatch(/\.carInline\s*\{[^}]*min-width:\s*0;/);
  });

  it('has the public chrome read the Theme messages and hand the header its label', () => {
    const chrome = read('src/app/PublicChrome.tsx');
    expect(chrome).toContain("getTranslations('Theme')");
    expect(chrome).toMatch(/themeLabel=\{\w+\('toggleLabel'\)\}/);
  });

  it('leaves the admin header without the switch', () => {
    expect(read('src/components/admin/AdminHeader.tsx')).not.toMatch(/ThemeSwitch|theme-storage/);
  });
});

// #398 review fixes (CR-1, CR-2): the header holds one 56 px row from 390 px and two rows, 104 px, from 352 to
// 389 px with no car (the figures are issue 399's header: 3 px rule, 52 px row, 1 px hairline). A height is a layout
// fact a unit test cannot measure (0006 rule 11), so these pin the rules the measurement rests on; the order and
// nesting of the markup they select is tests/unit/theme.test.ts.
describe('SiteHeader wrap rules of the review fixes (#398 CR-1, CR-2)', () => {
  it('CR-1: gives the header search field a 4.625rem (74 px) basis, the width that keeps the button on the field row at 390', () => {
    const css = read('src/components/SearchForm.module.css');
    expect(css).toMatch(/\.header\s+\.input\s*\{[^}]*flex-basis:\s*4\.625rem;/);
    expect(css).not.toMatch(/\.header\s+\.input\s*\{[^}]*flex-basis:\s*5rem;/);
  });

  it('CR-2: from 22rem to 24.37rem a trailing group that holds the inline car control takes row 2 whole, at the right edge', () => {
    const css = read('src/components/SiteHeader.module.css');
    const rule = css.match(
      /@media \(min-width: 22rem\) and \(max-width: 24\.37rem\)\s*\{\s*\.trailing:has\(> \.carInline\)\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/flex-basis:\s*100%;/);
    expect(rule?.[1]).toMatch(/justify-content:\s*flex-end;/);
  });

  it('CR-2: the range meets the rule below it and stops under 390 px, so no width between 22rem and 40rem is left to the old wrap', () => {
    const css = read('src/components/SiteHeader.module.css');
    expect(css).toMatch(/@media \(max-width: 21\.99rem\)\s*\{\s*\.trailing\s*\{/);
    // 24.37rem is 389.92 px: the group stays on row 1 from 390 px, where the row holds everything.
    expect(24.37 * 16).toBeLessThan(390);
    expect(24.37 * 16).toBeGreaterThan(389);
  });

  it('CR-2: keys the row-2 rule on the car control being inside the group, so a selected car (the switch alone) stays on row 1', () => {
    const css = read('src/components/SiteHeader.module.css');
    expect(css).toContain('.trailing:has(> .carInline)');
    expect(css).not.toMatch(/@media \(min-width: 22rem\) and \(max-width: 24\.37rem\)\s*\{\s*\.trailing\s*\{/);
  });

  it('CR-2: a page with its own search form (home, /buscar) keeps the group on row 1 at any width, basis auto', () => {
    const css = read('src/components/SiteHeader.module.css');
    expect(css).toMatch(/:global\(body:has\(\[data-search-page\]\)\)\s+\.trailing\s*\{[^}]*flex-basis:\s*auto;[^}]*margin-left:\s*auto;/);
  });
});
