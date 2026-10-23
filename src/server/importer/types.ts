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

/**
 * `record` numbers the first data row 2 in every format. CSV counts the header
 * as record 1; XML counts the n-th record element as record n + 1.
 */
export type RejectedRow = { record: number; code: RejectCode; field?: string };

export type FeedFailure =
  | 'fetch_failed'
  | 'unsupported_url'
  | 'invalid_header'
  | 'database_error'
  | 'invalid_xml' // malformed XML, a DOCTYPE, or no record element found
  | 'invalid_gzip' // starts with 1f 8b but does not inflate
  | 'too_large' // wire bytes > 50 MiB or inflated bytes > 512 MiB
  | 'redirect_refused'; // a hop to non-https, to another host, or a 6th hop

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

/** Raw feed bytes as served: maybe gzip, maybe CSV or XML. Consumed once. */
export type FeedBytes = AsyncIterable<Uint8Array>;

/**
 * A feed whose bytes are not a readable feed: malformed or refused XML, gzip
 * that does not inflate, or an inflated size over the cap. `code` is the
 * report's `failure`. The message never carries feed content.
 */
export class FeedFormatError extends Error {
  readonly code: Extract<FeedFailure, 'invalid_xml' | 'invalid_gzip' | 'too_large'>;

  constructor(code: FeedFormatError['code']) {
    super(code);
    this.name = 'FeedFormatError';
    this.code = code;
  }
}

export type ImportDeps = {
  /** Replaces the real source reader (tests). */
  readSource?: (feed: FeedSourceRef) => Promise<FeedBytes>;
  now?: () => Date;
};
