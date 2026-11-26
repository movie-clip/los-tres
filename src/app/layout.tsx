import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { THEME_SCRIPT } from '@/components/theme-storage';
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
// The head holds one blocking inline script (#398): it sets data-theme on html before the
// body is parsed, so the first paint is in the right scheme. Not next/script, which can run
// after a paint. The attribute differs from the server markup by design, hence
// suppressHydrationWarning on html. The script reads only the browser; the server never
// learns the scheme (guardrail 5).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
