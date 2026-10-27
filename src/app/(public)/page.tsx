import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { CategoryTree } from '@/components/CategoryTree';
import { getPublicOrigin, getSiteName } from '@/config/site';
import { getPublicCategoryTree } from '@/server/catalogue/category-tree';
import { categoryPath } from '@/server/catalogue/paths';
import { pageSeo } from '@/server/catalogue/seo';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// The home page is always indexable; the title and description come from the root layout.
export function generateMetadata(): Metadata {
  return pageSeo(getPublicOrigin(), '/', true);
}

export default async function HomePage() {
  const [t, groups] = await Promise.all([getTranslations('Home'), getPublicCategoryTree()]);

  return (
    <main>
      <section className={styles.panel} data-testid="home-panel">
        <div className={styles.panelInner}>
          <h1 className={styles.title}>{t('heading', { siteName: getSiteName() })}</h1>
          <p className={styles.tagline}>{t('tagline')}</p>
        </div>
      </section>
      <div className="page">
        {groups.length === 0 ? (
          <CategoryEmpty heading={t('emptyHeading')} body={t('emptyBody')} />
        ) : (
          <>
            <h2 className={styles.sectionTitle}>{t('categoriesHeading')}</h2>
            <CategoryTree
              groups={groups.map((group) => ({
                key: group.slug,
                href: categoryPath(group.slug),
                name: group.name,
                count: t('productCount', { count: group.productCount }),
                children: group.children.map((child) => ({
                  key: child.slug,
                  href: categoryPath(child.slug),
                  name: child.name,
                  count: t('productCount', { count: child.productCount }),
                })),
              }))}
            />
          </>
        )}
      </div>
    </main>
  );
}
