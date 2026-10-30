import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { toIllustrationKey } from '@/components/CategoryIllustration';
import { CategoryTiles } from '@/components/CategoryTiles';
import { SearchForm } from '@/components/SearchForm';
import { getPublicOrigin } from '@/config/site';
import { getCarContext, openedWithCoche } from '@/server/car/context';
import { getPublicCategoryTree } from '@/server/catalogue/category-tree';
import { categoryPath, SEARCH_PATH } from '@/server/catalogue/paths';
import { pageSeo } from '@/server/catalogue/seo';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// The home page is indexable unless it was opened with `coche` (S5.7); the title and
// description come from the root layout.
export async function generateMetadata(): Promise<Metadata> {
  const car = await getCarContext();
  return pageSeo(getPublicOrigin(), '/', !openedWithCoche(car));
}

export default async function HomePage() {
  const [t, tSearch, groups] = await Promise.all([
    getTranslations('Home'),
    getTranslations('Search'),
    getPublicCategoryTree(),
  ]);

  const root = groups[0];

  return (
    <main>
      <section className={styles.panel} data-testid="home-panel">
        <div className={styles.panelInner}>
          <h1 className={styles.title}>{t('heading')}</h1>
          <p className={styles.tagline}>{t('tagline')}</p>
          {root === undefined ? null : (
            <SearchForm
              variant="hero"
              action={SEARCH_PATH}
              formLabel={tSearch('formLabel')}
              fieldLabel={t('searchLabel')}
              button={t('searchButton')}
              hint={t('searchHint')}
              value={null}
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
