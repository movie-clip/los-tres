import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { PublicChrome } from './PublicChrome';

// Outside (public)/layout.tsx, so it renders the public chrome itself. Every
// unmatched URL, /admin/* included, ends here (the ordinary public 404).
export default async function NotFound() {
  const t = await getTranslations('NotFound');
  return (
    <PublicChrome>
      <main className="page">
        <h1>{t('heading')}</h1>
        <p>{t('body')}</p>
        <p>
          <Link href="/">{t('backHome')}</Link>
        </p>
      </main>
    </PublicChrome>
  );
}
