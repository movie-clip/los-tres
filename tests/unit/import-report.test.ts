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
    offersRemoved: 0,
    rejected: [],
    ownProducts: [],
    eanFilled: 0,
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
        'feed 1 "Tienda Demo Uno": imported rows=2 products_created=2 offers_created=2 offers_updated=0 offers_removed=0 rejected=0 unknown_vehicles=0',
        'feed 2 "Tienda Demo Dos": imported rows=3 products_created=1 offers_created=2 offers_updated=0 offers_removed=0 rejected=1 unknown_vehicles=0',
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

describe('formatImportReport, own-product rows (S7.1, AC 16, 17)', () => {
  const lines = (overrides: Partial<FeedImportReport>) =>
    formatImportReport({ startedAt, feeds: [feed({ rows: 3, productsCreated: 3, offersCreated: 3, ...overrides })] }).split('\n');

  it('prints one indented line per own-product row, in record order, after the rejected lines and before the fitment lines', () => {
    const out = lines({
      rejected: [{ record: 4, code: 'invalid_price', field: 'price' }],
      ownProducts: [
        { record: 2, reason: 'ean_brand_conflict' },
        { record: 3, reason: 'ambiguous_brand_part_number' },
      ],
      unknownVehicles: 1,
      unknownVehicleSlugs: [{ slug: 'coche-x', rows: 1 }],
    });
    expect(out.slice(1)).toEqual([
      '  record 4: invalid_price (price)',
      '  record 2: own_product ean_brand_conflict',
      '  record 3: own_product ambiguous_brand_part_number',
      '  fitment: unknown vehicle coche-x rows=1',
      'total: feeds=1 imported=1 skipped=0 failed=0',
    ]);
  });

  it('leaves the feed head line without a new count and does not count own products as rejected', () => {
    const [head] = lines({ ownProducts: [{ record: 2, reason: 'ambiguous_ean' }] });
    expect(head).toBe(
      'feed 1 "Tienda Demo Uno": imported rows=3 products_created=3 offers_created=3 offers_updated=0 offers_removed=0 rejected=0 unknown_vehicles=0',
    );
  });

  it('prints the four reasons verbatim and nothing else on the line', () => {
    const reasons = [
      'ean_brand_conflict',
      'ambiguous_ean',
      'brand_part_number_ean_conflict',
      'ambiguous_brand_part_number',
    ] as const;
    const out = lines({ ownProducts: reasons.map((reason, i) => ({ record: i + 2, reason })) });
    expect(out.slice(1, 5)).toEqual(reasons.map((reason, i) => `  record ${i + 2}: own_product ${reason}`));
  });

  it('does not change the exit code: own-product rows never fail a run', () => {
    expect(
      importExitCode({ startedAt, feeds: [feed({ ownProducts: [{ record: 2, reason: 'ambiguous_ean' }] })] }),
    ).toBe(0);
  });
});

describe('formatImportReport, offer removal (S3.3, AC 19)', () => {
  const run = (overrides: Partial<FeedImportReport>): string[] =>
    formatImportReport({ startedAt, feeds: [feed({ rows: 3, ...overrides })] }).split('\n');

  it('states the removed count on the imported line, zero included, between offers_updated and rejected', () => {
    expect(run({})[0]).toBe(
      'feed 1 "Tienda Demo Uno": imported rows=3 products_created=0 offers_created=0 offers_updated=0 offers_removed=0 rejected=0 unknown_vehicles=0',
    );
    expect(run({ offersRemoved: 7 })[0]).toBe(
      'feed 1 "Tienda Demo Uno": imported rows=3 products_created=0 offers_created=0 offers_updated=0 offers_removed=7 rejected=0 unknown_vehicles=0',
    );
  });

  it('prints no removal line for a feed that removed offers, or removed none and skipped nothing', () => {
    expect(run({ offersRemoved: 7 }).filter((line) => line.includes('removal'))).toEqual([]);
    expect(run({}).filter((line) => line.includes('removal'))).toEqual([]);
  });

  it.each(['empty_import', 'small_import'] as const)('prints the skipped %s line with its counts and a code only', (reason) => {
    const lines = run({ removalSkipped: { reason, missing: 12, current: 20 } });
    expect(lines).toEqual([
      expect.stringMatching(/ offers_removed=0 rejected=0 unknown_vehicles=0$/),
      `  removal: skipped ${reason} missing=12 current=20`,
      'total: feeds=1 imported=1 skipped=0 failed=0',
    ]);
  });

  it('prints the removal line last under its feed, after rejected, own-product and fitment lines', () => {
    const lines = run({
      rejected: [{ record: 4, code: 'invalid_price', field: 'price' }],
      ownProducts: [{ record: 2, reason: 'ean_brand_conflict' }],
      unknownVehicles: 5,
      unknownVehicleSlugs: [{ slug: 'coche-x', rows: 2 }],
      unknownVehiclesNotShown: 3,
      removalSkipped: { reason: 'small_import', missing: 10, current: 19 },
    });
    expect(lines.slice(1)).toEqual([
      '  record 4: invalid_price (price)',
      '  record 2: own_product ean_brand_conflict',
      '  fitment: unknown vehicle coche-x rows=2',
      '  fitment: unknown vehicle values not shown rows=3',
      '  removal: skipped small_import missing=10 current=19',
      'total: feeds=1 imported=1 skipped=0 failed=0',
    ]);
  });

  it('keeps a feed\'s removal line with its own feed when two feeds are printed', () => {
    const text = formatImportReport({
      startedAt,
      feeds: [
        feed({ rows: 1, removalSkipped: { reason: 'empty_import', missing: 3, current: 3 } }),
        feed({ feedId: 2, shopName: 'Tienda Demo Dos', rows: 1 }),
      ],
    }).split('\n');
    expect(text.indexOf('  removal: skipped empty_import missing=3 current=3')).toBe(1);
    expect(text[2]).toMatch(/^feed 2 /);
    expect(text.filter((line) => line.includes('removal'))).toHaveLength(1);
  });

  it('leaves a skipped and a failed feed line exactly as before, whatever the removal fields hold', () => {
    const noisy = { offersRemoved: 4, removalSkipped: { reason: 'small_import', missing: 9, current: 10 } } as const;
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

  it('counts a guard skip as an imported feed in the total, and never as a failure', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [feed({ removalSkipped: { reason: 'empty_import', missing: 2, current: 2 } })],
    };
    expect(formatImportReport(report).split('\n').at(-1)).toBe('total: feeds=1 imported=1 skipped=0 failed=0');
    expect(importExitCode(report)).toBe(0);
  });

  it('prints no URL and no row text with a removal line', () => {
    const text = run({ removalSkipped: { reason: 'small_import', missing: 10, current: 19 } }).join('\n');
    expect(text).not.toMatch(/https?:|demo-feed:|\.example/);
  });
});

describe('formatImportReport, filled EANs (S7.6, AC 17, 18, 19)', () => {
  const lines = (overrides: Partial<FeedImportReport>) =>
    formatImportReport({ startedAt, feeds: [feed({ rows: 3, productsCreated: 1, offersCreated: 3, ...overrides })] }).split('\n');

  it.each([1, 3, 12])('prints one `  ean: filled=%i` line when %i products were filled', (n) => {
    const out = lines({ eanFilled: n });
    expect(out.filter((line) => line.includes('ean:'))).toEqual([`  ean: filled=${n}`]);
    expect(out[1]).toBe(`  ean: filled=${n}`);
  });

  it('prints no ean line at 0, whatever else the feed reports', () => {
    const out = lines({
      eanFilled: 0,
      rejected: [{ record: 4, code: 'invalid_ean', field: 'ean' }],
      ownProducts: [{ record: 2, reason: 'ean_brand_conflict' }],
      unknownVehicles: 1,
      unknownVehicleSlugs: [{ slug: 'coche-x', rows: 1 }],
      removalSkipped: { reason: 'small_import', missing: 10, current: 19 },
    });
    expect(out.filter((line) => line.includes('ean:'))).toEqual([]);
  });

  it('formats a report with eanFilled 0 byte for byte as one that does not have the field', () => {
    const withField = feed({
      rows: 3,
      rejected: [{ record: 4, code: 'invalid_price', field: 'price' }],
      ownProducts: [{ record: 2, reason: 'ambiguous_ean' }],
      eanFilled: 0,
    });
    const without: Partial<FeedImportReport> = { ...withField };
    delete without.eanFilled;
    expect(formatImportReport({ startedAt, feeds: [without as FeedImportReport] })).toBe(
      formatImportReport({ startedAt, feeds: [withField] }),
    );
    expect(formatImportReport({ startedAt, feeds: [withField] })).not.toContain('ean:');
  });

  it('puts the line after the rejected and own-product lines, before the fitment lines and the removal line', () => {
    const out = lines({
      eanFilled: 2,
      rejected: [{ record: 4, code: 'invalid_price', field: 'price' }],
      ownProducts: [
        { record: 2, reason: 'ean_brand_conflict' },
        { record: 3, reason: 'ambiguous_brand_part_number' },
      ],
      unknownVehicles: 5,
      unknownVehicleSlugs: [{ slug: 'coche-x', rows: 2 }],
      unknownVehiclesNotShown: 3,
      removalSkipped: { reason: 'small_import', missing: 10, current: 19 },
    });
    expect(out.slice(1)).toEqual([
      '  record 4: invalid_price (price)',
      '  record 2: own_product ean_brand_conflict',
      '  record 3: own_product ambiguous_brand_part_number',
      '  ean: filled=2',
      '  fitment: unknown vehicle coche-x rows=2',
      '  fitment: unknown vehicle values not shown rows=3',
      '  removal: skipped small_import missing=10 current=19',
      'total: feeds=1 imported=1 skipped=0 failed=0',
    ]);
  });

  it('leaves the feed head line without a new count', () => {
    const [head] = lines({ eanFilled: 4 });
    expect(head).toBe(
      'feed 1 "Tienda Demo Uno": imported rows=3 products_created=1 offers_created=3 offers_updated=0 offers_removed=0 rejected=0 unknown_vehicles=0',
    );
  });

  it('carries nothing but the count: no record, product, EAN or row text', () => {
    const [, line] = lines({ eanFilled: 7 });
    expect(line).toMatch(/^ {2}ean: filled=\d+$/);
  });

  it('keeps each feed\'s line with its own feed when two feeds are printed', () => {
    const text = formatImportReport({
      startedAt,
      feeds: [
        feed({ rows: 1, eanFilled: 1 }),
        feed({ feedId: 2, shopName: 'Tienda Demo Dos', rows: 1 }),
        feed({ feedId: 3, shopName: 'Tienda Demo Tres', rows: 1, eanFilled: 5 }),
      ],
    }).split('\n');
    expect(text).toEqual([
      expect.stringMatching(/^feed 1 /),
      '  ean: filled=1',
      expect.stringMatching(/^feed 2 /),
      expect.stringMatching(/^feed 3 /),
      '  ean: filled=5',
      'total: feeds=3 imported=3 skipped=0 failed=0',
    ]);
  });

  it('never prints it for a skipped or failed feed, whatever the count holds', () => {
    const report: ImportReport = {
      startedAt,
      feeds: [
        feed({ feedId: 3, shopName: 'Tres', outcome: 'skipped', skipReason: 'not_approved', eanFilled: 4 }),
        feed({ feedId: 4, shopName: 'Cuatro', outcome: 'failed', failure: 'database_error', eanFilled: 4 }),
      ],
    };
    expect(formatImportReport(report)).toBe(
      [
        'feed 3 "Tres": skipped not_approved',
        'feed 4 "Cuatro": failed database_error',
        'total: feeds=2 imported=0 skipped=1 failed=1',
      ].join('\n'),
    );
  });

  it('does not change the exit code: a fill never fails a run, and a failed feed still does', () => {
    expect(importExitCode({ startedAt, feeds: [feed({ eanFilled: 9 })] })).toBe(0);
    expect(
      importExitCode({ startedAt, feeds: [feed({ eanFilled: 9 }), feed({ feedId: 2, outcome: 'failed', failure: 'database_error' })] }),
    ).toBe(1);
  });

  it('prints no URL and no row text with the line', () => {
    expect(lines({ eanFilled: 2 }).join('\n')).not.toMatch(/https?:|demo-feed:|\.example/);
  });
});
