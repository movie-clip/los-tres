// Header and row validation for the canonical feed CSV layout (C-15). Pure:
// no database, no network.

import { parseEan } from '../matching';
import { parseDecimalToCents } from '../money';
import type { RejectedRow } from './types';

const REQUIRED_COLUMNS = ['id', 'title', 'price', 'url'] as const;
const OPTIONAL_COLUMNS = [
  'brand',
  'part_number',
  'description',
  'ean',
  'currency',
  'category',
] as const;

/**
 * Every column name, required first. An XML record is handed to `validateRow`
 * as cells in exactly this order, with this list as its header.
 */
export const CANONICAL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS] as const;

type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];
type ColumnName = RequiredColumn | (typeof OPTIONAL_COLUMNS)[number];

/** Column name to its index in the record. An absent optional column is missing. */
export type ColumnIndex = Partial<Record<ColumnName, number>> & Record<RequiredColumn, number>;

/**
 * Matches header names trimmed and case-insensitively. `null` when a required
 * column is missing (the whole feed fails `invalid_header`). Extra columns are
 * ignored.
 */
export function readHeader(header: string[]): ColumnIndex | null {
  const known: readonly string[] = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];
  const index: Partial<Record<ColumnName, number>> = {};
  header.forEach((name, position) => {
    const key = name.trim().toLowerCase();
    if (known.includes(key) && index[key as ColumnName] === undefined) {
      index[key as ColumnName] = position;
    }
  });
  for (const name of REQUIRED_COLUMNS) {
    if (index[name] === undefined) return null;
  }
  return index as ColumnIndex;
}

export type ValidRow = {
  externalId: string;
  title: string;
  brand: string | null;
  partNumber: string | null;
  description: string | null;
  /** The EAN as received, trimmed; `eanNormalised` is the digit string. */
  ean: string | null;
  eanNormalised: string | null;
  priceCents: number;
  url: string;
  /** The feed's own category string, trimmed; null when absent or empty. Never rejects a row. */
  feedCategory: string | null;
};

export type RowResult = { ok: true; row: ValidRow } | { ok: false; reject: RejectedRow };

/** Validates one data record. `record` counts the header as record 1. */
export function validateRow(cells: string[], columns: ColumnIndex, record: number): RowResult {
  const cell = (name: ColumnName): string => {
    const position = columns[name];
    return position === undefined ? '' : (cells[position] ?? '').trim();
  };
  const optional = (name: ColumnName): string | null => cell(name) || null;
  const reject = (code: RejectedRow['code'], field: string): RowResult => ({
    ok: false,
    reject: { record, code, field },
  });

  const externalId = cell('id');
  if (externalId === '') return reject('missing_id', 'id');
  const title = cell('title');
  if (title === '') return reject('missing_title', 'title');
  const priceCents = parseDecimalToCents(cell('price'));
  if (priceCents === null) return reject('invalid_price', 'price');
  const currency = cell('currency');
  if (currency !== '' && currency.toUpperCase() !== 'EUR') {
    return reject('invalid_currency', 'currency');
  }
  const url = cell('url');
  if (!isHttpUrl(url)) return reject('invalid_url', 'url');
  const ean = parseEan(cell('ean'));
  if (ean.kind === 'invalid') return reject('invalid_ean', 'ean');

  return {
    ok: true,
    row: {
      externalId,
      title,
      brand: optional('brand'),
      partNumber: optional('part_number'),
      description: optional('description'),
      ean: ean.kind === 'valid' ? cell('ean') : null,
      eanNormalised: ean.kind === 'valid' ? ean.normalised : null,
      priceCents,
      url,
      feedCategory: optional('category'),
    },
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
