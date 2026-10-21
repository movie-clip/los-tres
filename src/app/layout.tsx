import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { getSiteName } from '@/config/site';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

import './globals.css';

// The site name is read per request, so one image serves any SITE_NAME.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Metadata');
  return {
    title: t('title', { siteName: getSiteName() }),
    description: t('description'),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations('Footer');
  // The three legal pages, in the owner's order. Plain paths, no configuration.
  const footerLinks = [
    { href: '/aviso-legal', label: t('legalNotice') },
    { href: '/privacidad', label: t('privacy') },
    { href: '/como-nos-financiamos', label: t('funding') },
  ];
  return (
    <html lang={locale}>
      <body>
        <SiteHeader siteName={getSiteName()} />
        {children}
        <SiteFooter links={footerLinks} />
      </body>
    </html>
  );
}
