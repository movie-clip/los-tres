import { getTranslations } from 'next-intl/server';

import { PublicFallbackProvider } from '@/components/PublicFallbackContext';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getSiteName } from '@/config/site';

/**
 * The public header and footer around a page. Shared by (public)/layout.tsx and
 * the root not-found.tsx, which sits outside that layout. Also hands the public
 * error boundary its finished strings. Not a route file.
 */
export async function PublicChrome({ children }: { children: React.ReactNode }) {
  const [t, tError, tNotFound] = await Promise.all([
    getTranslations('Footer'),
    getTranslations('Error'),
    getTranslations('NotFound'),
  ]);
  // The three legal pages, in the owner's order. Plain paths, no configuration.
  const footerLinks = [
    { href: '/aviso-legal', label: t('legalNotice') },
    { href: '/privacidad', label: t('privacy') },
    { href: '/como-nos-financiamos', label: t('funding') },
  ];
  return (
    <PublicFallbackProvider
      value={{ heading: tError('heading'), body: tError('body'), home: tNotFound('backHome') }}
    >
      <SiteHeader siteName={getSiteName()} />
      {children}
      <SiteFooter links={footerLinks} />
    </PublicFallbackProvider>
  );
}
