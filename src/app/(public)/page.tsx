import { getTranslations } from 'next-intl/server';

import { getSiteName } from '@/config/site';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const t = await getTranslations('Home');
  return (
    <main className="page">
      <h1>{t('heading', { siteName: getSiteName() })}</h1>
      <p>{t('tagline')}</p>
    </main>
  );
}
