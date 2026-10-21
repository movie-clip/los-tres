import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'use-intl/core';
import { describe, expect, it } from 'vitest';

import { LegalNoticeContent } from '@/app/(public)/aviso-legal/content';
import { FundingContent } from '@/app/(public)/como-nos-financiamos/content';
import { PrivacyContent } from '@/app/(public)/privacidad/content';
import { DemoNotice } from '@/components/DemoNotice';
import { SiteFooter } from '@/components/SiteFooter';
import type { OwnerIdentity } from '@/config/owner';

import messages from '../../messages/es-ES.json';

// The three legal content components take a translator and finished values, so
// they render here with the real messages and obviously fake identity values.

const SITE = 'Sitio de Prueba';
const OWNER: OwnerIdentity = {
  name: 'Titular de Prueba S.L.',
  nif: 'B00000000',
  address: 'Calle Falsa 123, 28000 Madrid',
  contactEmail: 'contacto@example.test',
  registry: 'Registro de prueba, tomo 1, folio 1',
};

const translator = (namespace: 'LegalNotice' | 'Privacy' | 'Funding') =>
  createTranslator({ locale: 'es-ES', messages, namespace, onError: (error) => { throw error; } });

const legalNotice = (owner: OwnerIdentity = OWNER) =>
  renderToStaticMarkup(
    createElement(LegalNoticeContent, {
      t: translator('LegalNotice') as never,
      siteName: SITE,
      owner,
    }),
  );
const privacy = (owner: OwnerIdentity = OWNER) =>
  renderToStaticMarkup(
    createElement(PrivacyContent, { t: translator('Privacy') as never, siteName: SITE, owner }),
  );
const funding = () =>
  renderToStaticMarkup(
    createElement(FundingContent, { t: translator('Funding') as never, siteName: SITE }),
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;
const text = (html: string) => html.replace(/<[^>]*>/g, ' ');

describe('LegalNoticeContent', () => {
  it('renders the heading, the four required identity items and the registry item when set', () => {
    const html = legalNotice();
    expect(html).toContain(`<h1`);
    expect(html).toContain(messages.LegalNotice.heading);
    expect(count(html, '<li')).toBe(5);
    expect(html).toContain(`Titular: ${OWNER.name}`);
    expect(html).toContain(OWNER.nif);
    expect(html).toContain(OWNER.address);
    expect(html).toContain('Datos registrales: Registro de prueba, tomo 1, folio 1');
  });

  it('shows no Datos registrales item at all when the registry is null', () => {
    const html = legalNotice({ ...OWNER, registry: null });
    expect(count(html, '<li')).toBe(4);
    expect(html).not.toContain('Datos registrales');
    expect(html).not.toContain('Registro de prueba');
  });

  it('puts the registry item last in the list', () => {
    const html = legalNotice();
    const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]).trim());
    expect(items).toHaveLength(5);
    expect(items[4]).toContain('Datos registrales');
  });

  it('links the contact email as mailto: with the address as the link text', () => {
    const html = legalNotice();
    expect(html).toContain(`href="mailto:${OWNER.contactEmail}"`);
    expect(html).toMatch(new RegExp(`<a[^>]*>${OWNER.contactEmail}</a>`));
  });

  it('shows the site name in the body and leaves no placeholder or marker', () => {
    const html = legalNotice();
    expect(html).toContain(SITE);
    const visible = text(html);
    expect(visible).not.toMatch(/[{}]/);
    expect(visible).not.toContain('**');
  });

  it('renders the six section headings in order', () => {
    const html = legalNotice();
    const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual([
      messages.LegalNotice.objectHeading,
      messages.LegalNotice.pricesHeading,
      messages.LegalNotice.demoHeading,
      messages.LegalNotice.ipHeading,
      messages.LegalNotice.linksHeading,
      messages.LegalNotice.lawHeading,
    ]);
  });

  it('escapes an owner value that looks like markup instead of parsing it', () => {
    const html = legalNotice({ ...OWNER, name: '<b>Titular</b> & {x}' });
    expect(html).toContain('&lt;b&gt;Titular&lt;/b&gt; &amp; {x}');
    expect(html).not.toContain('<b>Titular');
  });
});

describe('PrivacyContent', () => {
  it('renders one h1 and nine h2 in order', () => {
    const html = privacy();
    expect(count(html, '<h1')).toBe(1);
    const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1]);
    const p = messages.Privacy;
    expect(headings).toEqual([
      p.controllerHeading,
      p.cookiesHeading,
      p.dataHeading,
      p.leavingHeading,
      p.writingHeading,
      p.adminsHeading,
      p.recipientsHeading,
      p.rightsHeading,
      p.changesHeading,
    ]);
  });

  it('names the controller from the owner values', () => {
    const html = privacy();
    expect(html).toContain(OWNER.name);
    expect(html).toContain(OWNER.nif);
    expect(html).toContain(OWNER.address);
  });

  it('links the contact email twice (controller and rights) as mailto:', () => {
    const html = privacy();
    expect(count(html, `href="mailto:${OWNER.contactEmail}"`)).toBe(2);
  });

  it('links www.aepd.es to https://www.aepd.es with the parentheses outside the link', () => {
    const html = privacy();
    expect(count(html, 'href="https://www.aepd.es"')).toBe(1);
    expect(html).toMatch(/\(<a[^>]*href="https:\/\/www\.aepd\.es"[^>]*>www\.aepd\.es<\/a>\)/);
  });

  it('renders the three data lead-ins in <strong> and no ** marker', () => {
    const html = privacy();
    expect(count(html, '<strong>')).toBe(3);
    expect(text(html)).not.toContain('**');
  });

  it('leaves no placeholder or tag text visible and offers no registry (not needed here)', () => {
    const html = privacy({ ...OWNER, registry: null });
    expect(text(html)).not.toMatch(/[{}<>]/);
    expect(html).not.toContain('Datos registrales');
  });

  it('never links anywhere but the mailto: address and the AEPD', () => {
    const hrefs = [...privacy().matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(hrefs)).toEqual(new Set([`mailto:${OWNER.contactEmail}`, 'https://www.aepd.es']));
  });
});

describe('FundingContent', () => {
  it('renders the heading with the site name, one intro paragraph and three bold lead-ins', () => {
    const html = funding();
    expect(html).toContain(messages.Funding.heading.replace('{siteName}', SITE));
    expect(count(html, '<h2')).toBe(0);
    expect(count(html, '<p')).toBe(1);
    expect(count(html, '<li')).toBe(3);
    expect(count(html, '<strong>')).toBe(3);
  });

  it('has no link and no leftover marker', () => {
    const html = funding();
    expect(html).not.toContain('<a');
    expect(text(html)).not.toMatch(/[{}]|\*\*/);
  });
});

describe('SiteFooter', () => {
  const links = [
    { href: '/aviso-legal', label: messages.Footer.legalNotice },
    { href: '/privacidad', label: messages.Footer.privacy },
    { href: '/como-nos-financiamos', label: messages.Footer.funding },
  ];

  it('renders a footer landmark with one plain link per entry, in order', () => {
    const html = renderToStaticMarkup(createElement(SiteFooter, { links }));
    expect(html).toMatch(/^<footer/);
    const anchors = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(anchors).toEqual(links.map((link) => [link.href, link.label]));
  });

  it('holds no paragraph and no heading', () => {
    const html = renderToStaticMarkup(createElement(SiteFooter, { links }));
    expect(html).not.toMatch(/<(p|h[1-6])[\s>]/);
  });
});

describe('DemoNotice', () => {
  it('renders the text in a paragraph with role="note" and nothing interactive', () => {
    const html = renderToStaticMarkup(createElement(DemoNotice, { text: messages.DemoNotice.body }));
    expect(html).toMatch(/^<p[^>]*role="note"/);
    expect(html).toContain(messages.DemoNotice.body);
    expect(html).not.toMatch(/<(button|a|input)[\s>]/);
  });
});
