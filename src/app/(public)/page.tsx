import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { toIllustrationKey } from '@/components/CategoryIllustration';
import { CategoryTiles } from '@/components/CategoryTiles';
import { HomeSearch } from '@/components/HomeSearch';
import { getPublicOrigin } from '@/config/site';
import { getPublicCategoryTree } from '@/server/catalogue/category-tree';
import { categoryPath } from '@/server/catalogue/paths';
import { pageSeo } from '@/server/catalogue/seo';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// The home page is always indexable; the title and description come from the root layout.
export function generateMetadata(): Metadata {
  return pageSeo(getPublicOrigin(), '/', true);
}

type HomePageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const [t, groups, { q }] = await Promise.all([
    getTranslations('Home'),
    getPublicCategoryTree(),
    searchParams,
  ]);

  // Interim search mode (until the search page lands): only whether `q` is present
  // is read. Its value is never rendered, logged or stored.
  const showNotice = q !== undefined;
  const root = groups[0];

  return (
    <main>
      <section className={styles.panel} data-testid="home-panel">
        <div className={styles.panelInner}>
          <h1 className={styles.title}>{t('heading')}</h1>
          <p className={styles.tagline}>{t('tagline')}</p>
          {root === undefined ? null : (
            <HomeSearch
              label={t('searchLabel')}
              button={t('searchButton')}
              notice={showNotice ? t('searchNotice') : null}
            />
          )}
        </div>
      </section>
      <div className="page">
        {root === undefined ? (
          <CategoryEmpty heading={t('emptyHeading')} body={t('emptyBody')} />
        ) : (
          <>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t('categoriesHeading')}</h2>
              <a
                href={categoryPath(root.slug)}
                className={styles.allLink}
                data-testid="home-all-link"
              >
                <span>{t('allLink')}</span>
                <span className={styles.allCount} data-testid="home-all-count">
                  {t('productCount', { count: root.productCount })}
                </span>
              </a>
            </div>
            <CategoryTiles
              tiles={root.children.map((child) => ({
                key: child.slug,
                href: categoryPath(child.slug),
                name: child.name,
                count: t('productCount', { count: child.productCount }),
                illustration: toIllustrationKey(child.slug),
              }))}
            />
          </>
        )}
      </div>
    </main>
  );
}
