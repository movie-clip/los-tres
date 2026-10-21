import { getTranslations } from 'next-intl/server';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { CategoryTree } from '@/components/CategoryTree';
import { getSiteName } from '@/config/site';
import { getPublicCategoryTree } from '@/server/catalogue/category-tree';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [t, groups] = await Promise.all([getTranslations('Home'), getPublicCategoryTree()]);

  return (
    <main className="page">
      <section className={styles.panel} data-testid="home-panel">
        <h1 className={styles.title}>{t('heading', { siteName: getSiteName() })}</h1>
        <p className={styles.tagline}>{t('tagline')}</p>
      </section>
      {groups.length === 0 ? (
        <CategoryEmpty heading={t('emptyHeading')} body={t('emptyBody')} />
      ) : (
        <>
          <h2 className={styles.sectionTitle}>{t('categoriesHeading')}</h2>
          <CategoryTree
            groups={groups.map((group) => ({
              key: group.slug,
              href: `/categoria/${group.slug}`,
              name: group.name,
              count: t('productCount', { count: group.productCount }),
              children: group.children.map((child) => ({
                key: child.slug,
                href: `/categoria/${child.slug}`,
                name: child.name,
                count: t('productCount', { count: child.productCount }),
              })),
            }))}
          />
        </>
      )}
    </main>
  );
}
