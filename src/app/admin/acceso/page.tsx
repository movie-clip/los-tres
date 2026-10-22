import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AdminHeader } from '@/components/admin/AdminHeader';
import { getSiteName } from '@/config/site';
import { SESSION_LIFETIME_HOURS } from '@/server/auth/config';
import { checkAdminSession } from '@/server/auth/guard';

import { SignInForm } from './SignInForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Admin.Meta');
  return { title: t('signInTitle', { siteName: getSiteName() }) };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The only admin page without requireAdminPage: it is where an anonymous
 * request ends. A signed-in admin is sent on to the shell; a failed check is
 * treated as not signed in. `?aviso=` says why the visitor arrived and carries
 * nothing else; any other value shows no notice.
 */
export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const check = await checkAdminSession(await headers());
  if (check.kind === 'admin') redirect('/admin');

  const [t, chrome, params] = await Promise.all([
    getTranslations('Admin.SignIn'),
    getTranslations('Admin.Chrome'),
    searchParams,
  ]);
  const aviso = Array.isArray(params.aviso) ? params.aviso[0] : params.aviso;
  const notice =
    aviso === 'sesion'
      ? t('signInRequired', { hours: SESSION_LIFETIME_HOURS })
      : aviso === 'salida'
        ? t('signedOut')
        : null;

  return (
    <>
      <AdminHeader siteName={getSiteName()} areaLabel={chrome('areaLabel')} />
      <main className="page">
        <h1 className={styles.heading}>{t('heading')}</h1>
        <SignInForm
          notice={notice}
          labels={{
            emailLabel: t('emailLabel'),
            passwordLabel: t('passwordLabel'),
            submit: t('submit'),
            submitting: t('submitting'),
            emailRequired: t('emailRequired'),
            emailInvalid: t('emailInvalid'),
            passwordRequired: t('passwordRequired'),
            errorTitle: t('errorTitle'),
            invalidCredentials: t('invalidCredentials'),
            unavailable: t('unavailable'),
          }}
        />
      </main>
    </>
  );
}
