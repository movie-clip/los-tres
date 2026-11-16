import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'use-intl/core';
import { describe, expect, it } from 'vitest';

import { PrivacyContent } from '@/app/(public)/privacidad/content';
import type { OwnerIdentity } from '@/config/owner';

import messages from '../../messages/es-ES.json';

// S5.8 follow-up (D-18): the privacy page says the selected car is kept in the visitor's own browser.

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
});
