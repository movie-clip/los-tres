import { getTranslations } from 'next-intl/server';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getSiteName } from '@/config/site';

/**
 * The public header and footer around a page. Shared by (public)/layout.tsx and
 * the root not-found.tsx, which sits outside that layout. Not a route file.
 */
export async function PublicChrome({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('Footer');
  // The three legal pages, in the owner's order. Plain paths, no configuration.
  const footerLinks = [
    { href: '/aviso-legal', label: t('legalNotice') },
    { href: '/privacidad', label: t('privacy') },
    { href: '/como-nos-financiamos', label: t('funding') },
  ];
  return (
    <>
      <SiteHeader siteName={getSiteName()} />
      {children}
      <SiteFooter links={footerLinks} />
    </>
  );
}
