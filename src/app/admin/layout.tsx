import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AdminFallbackProvider } from '@/components/admin/AdminFallbackContext';
import { getSiteName } from '@/config/site';

// No admin page is indexed (noindex also arrives as a response header, next.config.ts).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Admin.Meta');
  return {
    title: t('title', { siteName: getSiteName() }),
    robots: { index: false, follow: false },
  };
}

/**
 * Admin routes carry no public header or footer (the root layout is bare). This
 * layout only hands the error boundary its finished strings; each admin screen
 * draws its own header, so the signed-in shell can add the identity and the menu.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [chrome, unavailable] = await Promise.all([
    getTranslations('Admin.Chrome'),
    getTranslations('Admin.Unavailable'),
  ]);
  return (
    <AdminFallbackProvider
      value={{
        siteName: getSiteName(),
        areaLabel: chrome('areaLabel'),
        heading: unavailable('heading'),
        body: unavailable('body'),
        retry: unavailable('retry'),
      }}
    >
      {children}
    </AdminFallbackProvider>
  );
}
