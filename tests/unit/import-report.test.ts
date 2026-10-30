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
    unknownVehicles: 0,
    unknownVehicleSlugs: [],
    unknownVehiclesNotShown: 0,
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
        'feed 1 "Tienda Demo Uno": imported rows=2 products_created=2 offers_created=2 offers_updated=0 rejected=0 unknown_vehicles=0',
        'feed 2 "Tienda Demo Dos": imported rows=3 products_created=1 offers_created=2 offers_updated=0 rejected=1 unknown_vehicles=0',
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

describe('formatImportReport, unknown vehicle slugs (S5.6, AC 22 to 25, 27)', () => {
  const run = (overrides: Partial<FeedImportReport>): string[] =>
    formatImportReport({ startedAt, feeds: [feed({ rows: 3, ...overrides })] }).split('\n');

  it('states the unknown count on the imported line, zero included, and prints no fitment line for zero', () => {
    const lines = run({});
    expect(lines[0]).toMatch(/ rejected=0 unknown_vehicles=0$/);
    expect(lines.filter((line) => line.includes('fitment:'))).toEqual([]);
  });

  it('prints one line per slug in the given order, with how many rows held it, after the reject lines', () => {
    const lines = run({
      rejected: [{ record: 4, code: 'invalid_price', field: 'price' }],
      unknownVehicles: 5,
      unknownVehicleSlugs: [
        { slug: 'zeta-3', rows: 3 },
        { slug: 'alfa-1', rows: 2 },
      ],
    });
    expect(lines.slice(0, 5)).toEqual([
      expect.stringMatching(/ rejected=1 unknown_vehicles=5$/),
      '  record 4: invalid_price (price)',
      '  fitment: unknown vehicle zeta-3 rows=3',
      '  fitment: unknown vehicle alfa-1 rows=2',
      'total: feeds=1 imported=1 skipped=0 failed=0',
    ]);
  });

  it('prints one not-shown line, last, for values that were counted but not printed', () => {
    const lines = run({
      unknownVehicles: 4,
      unknownVehicleSlugs: [{ slug: 'uno', rows: 1 }],
      unknownVehiclesNotShown: 3,
    });
    expect(lines.slice(1, 3)).toEqual([
      '  fitment: unknown vehicle uno rows=1',
      '  fitment: unknown vehicle values not shown rows=3',
    ]);
    expect(lines.filter((line) => line.includes('not shown'))).toHaveLength(1);
  });

  it('prints the same text for the same report on every call', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [
        feed({
          unknownVehicles: 3,
          unknownVehicleSlugs: [
            { slug: 'b-1', rows: 1 },
            { slug: 'a-1', rows: 2 },
          ],
        }),
      ],
    };
    expect(formatImportReport(report)).toBe(formatImportReport(report));
  });

  it('leaves a skipped and a failed feed line exactly as before, whatever the unknown fields hold', () => {
    const noisy = { unknownVehicles: 9, unknownVehicleSlugs: [{ slug: 'x-1', rows: 9 }], unknownVehiclesNotShown: 2 };
    const report: ImportReport = {
      startedAt,
      feeds: [
        feed({ feedId: 3, shopName: 'Tres', outcome: 'skipped', skipReason: 'not_approved', ...noisy }),
        feed({ feedId: 4, shopName: 'Cuatro', outcome: 'failed', failure: 'fetch_failed', ...noisy }),
      ],
    };
    expect(formatImportReport(report)).toBe(
      [
        'feed 3 "Tres": skipped not_approved',
        'feed 4 "Cuatro": failed fetch_failed',
        'total: feeds=2 imported=0 skipped=1 failed=1',
      ].join('\n'),
    );
  });

  it('still prints no URL with unknown slugs in the report', () => {
    const text = run({ unknownVehicles: 1, unknownVehicleSlugs: [{ slug: 'x-1', rows: 1 }] }).join('\n');
    expect(text).not.toMatch(/https?:|demo-feed:|\.example/);
  });

  it('does not change the exit code: unknown slugs never fail a run (AC 26)', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [feed({ unknownVehicles: 50, unknownVehiclesNotShown: 50 })],
    };
    expect(importExitCode(report)).toBe(0);
  });
});
