// Import report and dependency types (C-16). Pure.

import type { OwnProductReason } from '../matching';

export type RejectCode =
  | 'missing_id'
  | 'missing_title'
  | 'invalid_price'
  | 'invalid_currency'
  | 'invalid_ean'
  | 'invalid_url'
  | 'duplicate_id';

/** A row that became its own product because of a conflict or an ambiguity (S7.1, AC 17). */
export type OwnProductRow = { record: number; reason: OwnProductReason };

/**
 * `record` numbers the first data row 2 in every format. CSV counts the header
 * as record 1; XML counts the n-th record element as record n + 1.
 */
export type RejectedRow = { record: number; code: RejectCode; field?: string };

/** A slug-shaped fitment value that names no vehicle, and the accepted rows that carried it. */
export type UnknownVehicleSlug = { slug: string; rows: number };

export type FeedFailure =
  | 'fetch_failed'
  | 'unsupported_url'
  | 'invalid_header'
  | 'database_error'
  | 'invalid_xml' // malformed XML, a DOCTYPE, or no record element found
  | 'invalid_gzip' // starts with 1f 8b but does not inflate
  | 'too_large' // wire bytes > 50 MiB or inflated bytes > 512 MiB
  | 'redirect_refused' // a hop to non-https, to another host, or a 6th hop
  | 'file_name_refused' // a catalogue-file feed whose stored value is not a bare file name
  | 'file_not_found' // the catalogue folder or the exact file is not there
  | 'file_refused'; // the folder or file is a link, not a regular file, or changed under us

export type RemovalSkipReason = 'empty_import' | 'small_import';
/** Removal did not run for an imported feed (S3.3). `missing` offers would have been removed. */
export type RemovalSkip = { reason: RemovalSkipReason; missing: number; current: number };

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
  /** Offers flagged removed by this import; 0 when skipped, failed or nothing was missing. */
  offersRemoved: number;
  /** Present only on an imported feed whose removal was skipped. */
  removalSkipped?: RemovalSkip;
  rejected: RejectedRow[];
  /** Counted in productsCreated and offersCreated, never in rejected. Record order. */
  ownProducts: OwnProductRow[];
  /** Every unknown vehicle slug occurrence: one per accepted row per distinct slug. */
  unknownVehicles: number;
  /** Printable unknown slugs only, first-seen order, at most 20. */
  unknownVehicleSlugs: UnknownVehicleSlug[];
  /** Occurrences not in the list: not slug-shaped, or past the 20th distinct slug. */
  unknownVehiclesNotShown: number;
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
export type FeedSourceRef = {
  id: number;
  url: string;
  isDemo: boolean;
  /** `catalogue_file`: `url` is a file name in the catalogue folder, not an address. */
  sourceType: 'affiliate_network' | 'shop_upload' | 'catalogue_file';
};

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
