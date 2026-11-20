// The one rule for the file name of a catalogue-file feed (S3.7, C-2). Pure: no
// `server-only`, no `fs`, no database. The admin writers check a name with it
// before storing it, and the importer checks the stored value again before it
// opens anything, so a name is never trusted for being in the database.
//
// A name is one bare file name in the one catalogue folder. ASCII only, so a
// Windows host and the Linux container read the same bytes under the same name
// (no NFC/NFD difference).

export const CATALOGUE_FILE_NAME_MAX = 100;
export const CATALOGUE_FILE_KINDS = ['.csv', '.xml', '.csv.gz', '.xml.gz'] as const;

export type CatalogueFileNameError =
  | 'required'
  | 'too_long'
  | 'not_a_name'
  | 'unusable'
  | 'wrong_kind';

/** Windows device names refuse to be files, with or without an extension. */
const DEVICE_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ALLOWED_CHARACTERS = /^[A-Za-z0-9._-]+$/;

/**
 * Trims the name, then returns the first error in the order the form shows
 * them. Whether the name is already registered for the shop is the database's
 * to say, not this module's.
 */
export function checkCatalogueFileName(raw: string): {
  value: string;
  error: CatalogueFileNameError | null;
} {
  const value = raw.trim();
  return { value, error: firstError(value) };
}

function firstError(value: string): CatalogueFileNameError | null {
  if (value === '') return 'required';
  if ([...value].length > CATALOGUE_FILE_NAME_MAX) return 'too_long';
  if (isNotAName(value)) return 'not_a_name';
  if (!ALLOWED_CHARACTERS.test(value)) return 'unusable';
  if (!hasKind(value)) return 'wrong_kind';
  return null;
}

/**
 * A path, a drive, a scheme, a stream, a hidden name, a parent step or a device
 * name: anything that is not one plain name in the folder.
 */
function isNotAName(value: string): boolean {
  if (/[/\\:]/.test(value)) return true;
  if (value.startsWith('.')) return true;
  if (value.includes('..')) return true;
  return DEVICE_STEM.test(value.split('.')[0]);
}

/** Ends in one of the four kinds with something before it. */
function hasKind(value: string): boolean {
  const lower = value.toLowerCase();
  return CATALOGUE_FILE_KINDS.some((kind) => lower.endsWith(kind) && lower.length > kind.length);
}

/**
 * True for a stored value that is exactly an accepted name: no trim, so a
 * stored value with padding is not a name. The importer gates on this.
 */
export function isCatalogueFileName(stored: string): boolean {
  return stored === stored.trim() && firstError(stored) === null;
}

/** The stored value when it is a name, else null (a planted or old value is never shown). */
export function displayableFileName(stored: string): string | null {
  return isCatalogueFileName(stored) ? stored : null;
}
