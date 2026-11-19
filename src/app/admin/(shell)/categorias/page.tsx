import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';

import { CategoriesPage } from '@/components/admin/CategoriesPage';
import { CategoryFeedRows } from '@/components/admin/CategoryFeedRows';
import { CategoryFeedSection } from '@/components/admin/CategoryFeedSection';
import { getSiteName } from '@/config/site';
import { LOCALE } from '@/i18n/locale';
import {
  listCategoryMappingsForAdmin,
  type AdminCategoryFeed,
  type CategoryTarget,
} from '@/server/admin/category-mappings';
import { requireAdminPage } from '@/server/auth/guard';

import { assignCategoryAction, markOutsideScopeAction, removeCategoryMappingAction } from './actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // Next resolves metadata before the page body, so this is a server entry point of
  // an admin route: the role check comes first (guardrail 3). Cached per request.
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  return { title: t('categoriesTitle', { siteName: getSiteName() }) };
}

type Translate = Awaited<ReturnType<typeof getTranslations<'Admin.Categories'>>>;
type SourcesTranslate = Awaited<ReturnType<typeof getTranslations<'Admin.Sources'>>>;

const SOURCES_PATH = '/admin/tiendas';

// CLDR drops the separator on four digits; the design wants 1.234 categorías.
const countFormat = new Intl.NumberFormat(LOCALE, { useGrouping: 'always' });

const ACTIONS = {
  assign: assignCategoryAction,
  outside: markOutsideScopeAction,
  remove: removeCategoryMappingAction,
};

/** The messages the client rows read: `Admin.Categories`, plus the three reused feed strings (one string, one home). */
async function clientMessages() {
  const admin = (await getMessages()).Admin as unknown as Record<string, Record<string, string>>;
  return {
    Admin: {
      Categories: admin.Categories,
      Sources: { errorTitle: admin.Sources.errorTitle },
      Form: { failedBody: admin.Form.failedBody, saving: admin.Form.saving, cancel: admin.Form.cancel },
    },
  };
}

function feedSection(feed: AdminCategoryFeed, targets: CategoryTarget[], t: Translate, sources: SourcesTranslate) {
  const paused = feed.approved && !feed.shopApproved;
  const title = t('feedHeading', { id: feed.id, shop: feed.shopName });
  // The host or a fixed phrase: the stored address is never a fallback (AC 10).
  const domain = feed.host ?? (feed.demo ? sources('domainNone') : sources('domainUnavailable'));
  const stateWord = !feed.approved ? sources('feedNotApproved') : paused ? sources('feedPaused') : sources('feedApproved');
  const notes = [
    !feed.approved ? t('feedNoteNotApproved') : null,
    paused ? sources('feedNotePaused') : null,
    feed.demo ? t('demoNote') : null,
  ].filter((note): note is string => note !== null);

  const total = feed.rows.length;
  const pending = feed.rows.filter((row) => row.state.kind === 'not_reviewed').length;
  // Screen states come from the data (04-ux section 4.4): no rows and no offers is never imported,
  // no rows with offers is a feed that brings no category.
  const statement =
    total > 0 ? null : feed.hasOffers ? t('feedNoCategories') : t('feedNeverImported');
  const emptyCells = feed.emptyCellProducts;

  return (
    <CategoryFeedSection
      key={feed.id}
      id={feed.id}
      title={title}
      demo={feed.demo}
      demoLabel={sources('demoMark')}
      domain={{ label: sources('domainLabel'), value: domain }}
      meta={feed.networkName !== null ? sources('feedMetaNetwork', { network: feed.networkName }) : sources('feedMetaUpload')}
      state={{ label: t('feedStateLabel'), value: stateWord }}
      notes={notes}
      statement={statement}
      summary={
        total > 0
          ? t('feedSummary', {
              total,
              totalText: countFormat.format(total),
              pending,
              pendingText: countFormat.format(pending),
            })
          : null
      }
      emptyCellNote={
        emptyCells > 0 ? t('emptyCellNote', { count: emptyCells, countText: countFormat.format(emptyCells) }) : null
      }
    >
      {/* Always drawn, even with no rows, so a result for a row that vanished keeps its place at the feed level. */}
      <CategoryFeedRows feedId={feed.id} feedTitle={title} rows={feed.rows} targets={targets} actions={ACTIONS} />
    </CategoryFeedSection>
  );
}

export default async function AdminCategoriesPage() {
  // The role check of this page (guardrail 3); the layout also checks, once per request.
  await requireAdminPage();
  const [t, sources, page, messages] = await Promise.all([
    getTranslations('Admin.Categories'),
    getTranslations('Admin.Sources'),
    listCategoryMappingsForAdmin(),
    clientMessages(),
  ]);

  const pending = page.feeds.reduce(
    (sum, feed) => sum + feed.rows.filter((row) => row.state.kind === 'not_reviewed').length,
    0,
  );
  const hasFeeds = page.feeds.length > 0;
  return (
    <CategoriesPage
      heading={t('heading')}
      rules={[t('intro'), t('rulePublic'), t('ruleRemove')]}
      summary={
        hasFeeds
          ? t('summary', { feeds: page.feeds.length, pending, pendingText: countFormat.format(pending) })
          : null
      }
      listLabel={t('listLabel')}
      empty={hasFeeds ? null : { text: t('feedsEmpty'), link: { href: SOURCES_PATH, label: t('feedsEmptyLink') } }}
    >
      <NextIntlClientProvider messages={messages}>
        {page.feeds.map((feed) => feedSection(feed, page.targets, t, sources))}
      </NextIntlClientProvider>
    </CategoriesPage>
  );
}
