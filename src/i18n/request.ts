import { getRequestConfig } from 'next-intl/server';

import { LOCALE } from './locale';

// Fixed locale, no middleware and no routing: next-intl's middleware sets a
// locale cookie, which guardrail 5 forbids for public visitors (TD-4).
export default getRequestConfig(async () => ({
  locale: LOCALE,
  messages: (await import('../../messages/es-ES.json')).default,
}));
