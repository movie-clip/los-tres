import { getTranslations } from 'next-intl/server';

import styles from './NotFoundContent.module.css';

/**
 * The body of the public 404: heading, sentence, and the way back home. No
 * chrome, so (public)/not-found.tsx renders it inside the layout's chrome and
 * the root not-found.tsx wraps it in PublicChrome. No data from the missing
 * item is shown. `homeHref` is the home link target, finished by the caller: `/` or
 * `/?coche=<slug>` (S5.7); a plain anchor, so a change of car is always a full load (D8).
 */
export async function NotFoundContent({ homeHref = '/' }: { homeHref?: string }) {
  const t = await getTranslations('NotFound');
  return (
    <main className="page">
      <h1 className={styles.heading}>{t('heading')}</h1>
      <p>{t('body')}</p>
      <p>
        <a href={homeHref} className={styles.home}>
          {t('backHome')}
        </a>
      </p>
    </main>
  );
}
