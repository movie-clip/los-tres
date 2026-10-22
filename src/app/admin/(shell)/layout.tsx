import { getTranslations } from 'next-intl/server';

import { AdminHeader } from '@/components/admin/AdminHeader';
import { AdminNav } from '@/components/admin/AdminNav';
import { getSiteName } from '@/config/site';
import { signOutAction } from '@/server/auth/actions';
import { requireAdminPage } from '@/server/auth/guard';

/**
 * The signed-in admin chrome: header with identity and sign-out, then the menu.
 * The layout checks the session so no chrome is built for an anonymous request,
 * but the layout is not the protection: every page in this group calls
 * requireAdminPage itself.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  const [chrome, nav] = await Promise.all([
    getTranslations('Admin.Chrome'),
    getTranslations('Admin.Nav'),
  ]);
  return (
    <>
      <AdminHeader
        siteName={getSiteName()}
        areaLabel={chrome('areaLabel')}
        identity={{
          signedInAs: chrome('signedInAs'),
          email: admin.email,
          fallback: chrome('identityFallback'),
        }}
        signOut={{
          action: signOutAction,
          label: chrome('signOut'),
          pendingLabel: chrome('signingOut'),
        }}
      />
      <AdminNav
        label={chrome('navLabel')}
        comingSoon={nav('comingSoon')}
        // Only the shell exists, so "Inicio" is the current page. The other
        // entries have no destination yet and render as placeholders (AC 25).
        items={[
          { key: 'home', label: nav('home'), href: '/admin', current: true },
          { key: 'feeds', label: nav('feeds') },
          { key: 'categories', label: nav('categories') },
          { key: 'products', label: nav('products') },
          { key: 'review', label: nav('review') },
        ]}
      />
      {children}
    </>
  );
}
