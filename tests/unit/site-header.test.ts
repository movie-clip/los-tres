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
