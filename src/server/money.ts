// The one money helper (guardrail 4). Pure: no `server-only`, so the importer
// (parse) and a server component (format) both import it. Money is integer
// cents, EUR, IVA included; no float is stored, summed or returned.

const DECIMAL_PRICE = /^(\d{1,7})(?:[.,](\d{1,2}))?$/;

/**
 * Parses decimal text such as `19.99`, `19,99` or `12` straight to integer
 * cents by digit handling, never through a float. Returns `null` for anything
 * else: more than two decimals (never rounded), thousands separators, signs,
 * exponents, blanks, and zero. At most 9 999 999,99, so it fits `integer`.
 */
export function parseDecimalToCents(text: string): number | null {
  const match = DECIMAL_PRICE.exec(text.trim());
  if (!match) return null;
  const euros = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const total = euros * 100 + cents;
  return total > 0 ? total : null;
}

const euroFormat = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  // CLDR drops the separator on four digits; the design wants 1.234,50 €.
  useGrouping: 'always',
});

/**
 * Formats integer cents for display, for example `1999` gives `19,99 €` (the
 * space before the euro sign is U+00A0). Throws `RangeError` for a non-integer
 * or negative argument. The only division by 100 in the code base lives here.
 */
export function formatEuroCents(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError('cents must be a non-negative integer');
  }
  return euroFormat.format(cents / 100);
}
