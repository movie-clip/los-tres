// The CLI's stdout for an import (C-16). Pure. Prints ids, shop names, counts
// and codes; never a URL and never the content of a row, except the slug-shaped
// unknown vehicle slugs of the fitment field (bounded by fitments.ts).

import type { FeedImportReport, ImportReport } from './types';

function feedLines(feed: FeedImportReport): string[] {
  const head = `feed ${feed.feedId} "${feed.shopName}":`;
  if (feed.outcome === 'skipped') return [`${head} skipped ${feed.skipReason ?? 'not_approved'}`];
  if (feed.outcome === 'failed') return [`${head} failed ${feed.failure ?? 'database_error'}`];
  return [
    `${head} imported rows=${feed.rows} products_created=${feed.productsCreated} ` +
      `offers_created=${feed.offersCreated} offers_updated=${feed.offersUpdated} ` +
      `rejected=${feed.rejected.length} unknown_vehicles=${feed.unknownVehicles}`,
    ...feed.rejected.map(
      (row) => `  record ${row.record}: ${row.code}${row.field ? ` (${row.field})` : ''}`,
    ),
    ...feed.unknownVehicleSlugs.map(
      (unknown) => `  fitment: unknown vehicle ${unknown.slug} rows=${unknown.rows}`,
    ),
    ...(feed.unknownVehiclesNotShown > 0
      ? [`  fitment: unknown vehicle values not shown rows=${feed.unknownVehiclesNotShown}`]
      : []),
  ];
}

/** One line per feed (rejected rows indented under it), then a total line. */
export function formatImportReport(report: ImportReport): string {
  const count = (outcome: FeedImportReport['outcome']) =>
    report.feeds.filter((feed) => feed.outcome === outcome).length;
  return [
    ...report.feeds.flatMap(feedLines),
    `total: feeds=${report.feeds.length} imported=${count('imported')} ` +
      `skipped=${count('skipped')} failed=${count('failed')}`,
  ].join('\n');
}

/** 1 when any feed failed, else 0. Rejected rows alone never fail a run. */
export function importExitCode(report: ImportReport): 0 | 1 {
  return report.feeds.some((feed) => feed.outcome === 'failed') ? 1 : 0;
}
