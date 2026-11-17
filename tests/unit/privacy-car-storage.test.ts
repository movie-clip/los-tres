import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'use-intl/core';
import { describe, expect, it } from 'vitest';

import { PrivacyContent } from '@/app/(public)/privacidad/content';
import type { OwnerIdentity } from '@/config/owner';

import messages from '../../messages/es-ES.json';

// S5.8 follow-ups (D-18, D-22): the privacy page says the selected car is kept in the visitor's own browser,
// under a heading that names local storage too.

const SITE = 'Sitio de Prueba';
const OWNER: OwnerIdentity = {
  name: 'Titular de Prueba S.L.',
  nif: 'B00000000',
  address: 'Calle Falsa 123, 28000 Madrid',
  contactEmail: 'contacto@example.test',
  registry: null,
};

// The ruled wording, typed out: the message file is not the oracle for itself.
const D18 =
  `${SITE} no instala cookies en el navegador de los visitantes, por eso no verás ningún aviso de cookies. ` +
  'Si eliges un coche, lo recordamos solo en tu propio navegador (almacenamiento local) para filtrar los productos; ' +
  'no se envía a nuestros servidores ni se guarda en ellos, y puedes quitarlo cuando quieras desde el selector de coche.';

// D-22: the heading names both topics, so on its own it does not read as "nothing is stored".
const HEADING = 'Cookies y almacenamiento local';

const html = renderToStaticMarkup(
  createElement(PrivacyContent, {
    t: createTranslator({ locale: 'es-ES', messages, namespace: 'Privacy' }) as never,
    siteName: SITE,
    owner: OWNER,
  }),
);

describe('the privacy page and the selected car', () => {
  it('shows the D-18 sentence exactly, with the site name filled in', () => {
    expect(html).toContain(D18.replace(/&/g, '&amp;'));
  });

  it('keeps the message file on the ruled wording, with the site name placeholder', () => {
    expect(messages.Privacy.cookiesBody).toBe(D18.replace(SITE, '{siteName}'));
  });

  it('puts the D-22 heading directly above the D-18 sentence', () => {
    expect(messages.Privacy.cookiesHeading).toBe(HEADING);
    const heading = html.indexOf(`>${HEADING}</h2>`);
    expect(heading).toBeGreaterThan(-1);
    // The next heading comes after the sentence, so the sentence sits under this one.
    const sentence = html.indexOf(D18.slice(0, 40));
    expect(sentence).toBeGreaterThan(heading);
    const next = html.indexOf('<h2', heading + 1);
    expect(next === -1 || next > sentence).toBe(true);
    expect(html).not.toContain('No usamos cookies');
  });
});
