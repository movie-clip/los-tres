import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import styles from './NotFoundContent.module.css';

/**
 * The body of the public 404: heading, sentence, and the way back home. No
 * chrome, so (public)/not-found.tsx renders it inside the layout's chrome and
 * the root not-found.tsx wraps it in PublicChrome. No data from the missing
 * item is shown.
 */
export async function NotFoundContent() {
  const t = await getTranslations('NotFound');
  return (
    <main className="page">
      <h1>{t('heading')}</h1>
      <p>{t('body')}</p>
      <p>
        <Link href="/" className={styles.home}>
          {t('backHome')}
        </Link>
      </p>
    </main>
  );
}
