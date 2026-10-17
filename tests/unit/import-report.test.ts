import { describe, expect, it } from 'vitest';

import { formatImportReport, importExitCode } from '@/server/importer/report';
import type { FeedImportReport, ImportReport } from '@/server/importer/types';

function feed(overrides: Partial<FeedImportReport>): FeedImportReport {
  return {
    feedId: 1,
    shopName: 'Tienda Demo Uno',
    outcome: 'imported',
    rows: 0,
    productsCreated: 0,
    offersCreated: 0,
    offersUpdated: 0,
    rejected: [],
    ...overrides,
  };
}

const startedAt = new Date('2026-10-17T10:00:00Z');

describe('formatImportReport (C-16)', () => {
  it('prints the exact C-16 lines: one per feed, rejected rows indented, then a total', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [
        feed({ rows: 2, productsCreated: 2, offersCreated: 2 }),
        feed({
          feedId: 2,
          shopName: 'Tienda Demo Dos',
          rows: 3,
          productsCreated: 1,
          offersCreated: 2,
          rejected: [{ record: 5, code: 'invalid_price', field: 'price' }],
        }),
      ],
    };
    expect(formatImportReport(report)).toBe(
      [
        'feed 1 "Tienda Demo Uno": imported rows=2 products_created=2 offers_created=2 offers_updated=0 rejected=0',
        'feed 2 "Tienda Demo Dos": imported rows=3 products_created=1 offers_created=2 offers_updated=0 rejected=1',
        '  record 5: invalid_price (price)',
        'total: feeds=2 imported=2 skipped=0 failed=0',
      ].join('\n'),
    );
  });

  it('prints a skipped feed as "skipped not_approved"', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [feed({ feedId: 3, shopName: 'Tienda Tres', outcome: 'skipped', skipReason: 'not_approved' })],
    };
    expect(formatImportReport(report)).toBe(
      'feed 3 "Tienda Tres": skipped not_approved\ntotal: feeds=1 imported=0 skipped=1 failed=0',
    );
  });

  it('prints a failed feed with its failure code', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [feed({ feedId: 4, shopName: 'Tienda Cuatro', outcome: 'failed', failure: 'fetch_failed' })],
    };
    expect(formatImportReport(report)).toBe(
      'feed 4 "Tienda Cuatro": failed fetch_failed\ntotal: feeds=1 imported=0 skipped=0 failed=1',
    );
  });

  it('prints a rejected row without a field when it has none', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [feed({ rows: 1, rejected: [{ record: 2, code: 'duplicate_id' }] })],
    };
    expect(formatImportReport(report)).toContain('\n  record 2: duplicate_id\n');
  });

  it('prints only the total for an empty run', () => {
    expect(formatImportReport({ startedAt, feeds: [] })).toBe(
      'total: feeds=0 imported=0 skipped=0 failed=0',
    );
  });

  it('never prints a URL', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [feed({ rows: 1, rejected: [{ record: 2, code: 'invalid_url', field: 'url' }] })],
    };
    expect(formatImportReport(report)).not.toMatch(/https?:|demo-feed:|\.example/);
  });
});

describe('importExitCode (C-16)', () => {
  it('is 0 when every feed imported or was skipped', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [feed({}), feed({ feedId: 2, outcome: 'skipped', skipReason: 'not_approved' })],
    };
    expect(importExitCode(report)).toBe(0);
  });

  it('is 0 for an empty run', () => {
    expect(importExitCode({ startedAt, feeds: [] })).toBe(0);
  });

  it('is 0 when rows were rejected but no feed failed', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [feed({ rows: 4, rejected: [{ record: 3, code: 'invalid_price', field: 'price' }] })],
    };
    expect(importExitCode(report)).toBe(0);
  });

  it('is 1 when any feed failed', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [feed({}), feed({ feedId: 2, outcome: 'failed', failure: 'database_error' })],
    };
    expect(importExitCode(report)).toBe(1);
  });
});
