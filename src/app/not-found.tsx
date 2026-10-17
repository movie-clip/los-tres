import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('NotFound');
  return (
    <main className="page">
      <h1>{t('heading')}</h1>
      <p>{t('body')}</p>
      <p>
        <Link href="/">{t('backHome')}</Link>
      </p>
    </main>
  );
}
