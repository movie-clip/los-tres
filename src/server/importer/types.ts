// Import report and dependency types (C-16). Pure.

export type RejectCode =
  | 'missing_id'
  | 'missing_title'
  | 'invalid_price'
  | 'invalid_currency'
  | 'invalid_ean'
  | 'invalid_url'
  | 'duplicate_id'
  | 'ean_brand_conflict'
  | 'ambiguous_ean';

/** `record` counts the CSV header as record 1. */
export type RejectedRow = { record: number; code: RejectCode; field?: string };

export type FeedFailure = 'fetch_failed' | 'unsupported_url' | 'invalid_header' | 'database_error';

export type FeedImportReport = {
  feedId: number;
  shopName: string;
  outcome: 'imported' | 'skipped' | 'failed';
  skipReason?: 'not_approved';
  failure?: FeedFailure;
  rows: number;
  productsCreated: number;
  offersCreated: number;
  offersUpdated: number;
  rejected: RejectedRow[];
};

export type ImportReport = { startedAt: Date; feeds: FeedImportReport[] };

/** `--feed <id>` named a feed that is not a registered row. */
export class FeedNotRegisteredError extends Error {
  constructor() {
    super('feed is not registered');
    this.name = 'FeedNotRegisteredError';
  }
}

/** The feed row a source reader receives. `url` can hold an API key: never print it. */
export type FeedSourceRef = { id: number; url: string; isDemo: boolean };

export type ImportDeps = {
  /** Replaces the real source reader (tests). */
  readSource?: (feed: FeedSourceRef) => Promise<string>;
  now?: () => Date;
};
