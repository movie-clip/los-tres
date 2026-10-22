import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { getSiteName } from '@/config/site';

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

// html and body only. The public header and footer live in (public)/layout.tsx
// and not-found.tsx, so an admin route never shows them.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
