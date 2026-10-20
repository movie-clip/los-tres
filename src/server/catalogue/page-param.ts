// The `?pagina` query parameter of a listing page (C-4). Pure.

/**
 * `?pagina` value to a page number >= 1. Never throws. Anything that is not a
 * plain run of digits (absent, repeated, empty, signed, decimal, padded with
 * spaces, text) is page 1, and so is `0`. Leading zeros are allowed. A value
 * past the safe integer range is capped at `Number.MAX_SAFE_INTEGER`, which
 * the read function then reports as past the last page.
 */
export function parsePageParam(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return 1;
  const page = Number(value);
  if (page < 1) return 1;
  return Math.min(page, Number.MAX_SAFE_INTEGER);
}
