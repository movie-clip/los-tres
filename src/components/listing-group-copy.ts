import type { ListingGroupKind } from './ListingGroup';

/** The Fit messages a group's copy needs, as the page's `getTranslations('Fit')` gives them. */
type FitTranslator = (
  key: 'fitsHeading' | 'unknownHeading' | 'unknownHelp' | 'exactHeading' | 'exactHelp',
  values?: Record<string, string | number>,
) => string;

/**
 * The heading and the help of one listing group under a selected car, shared by the
 * category page and the search page. `exactCount` is the exact-hit group's total
 * across all pages, not the cards of the page; it is null where the listing never
 * returns that group (the category page), so a card of it there is a fault.
 */
export function groupCopy(
  tFit: FitTranslator,
  group: ListingGroupKind,
  name: string,
  exactCount: number | null,
): { heading: string; help: string | null } {
  switch (group) {
    case 'fits':
      return { heading: tFit('fitsHeading', { car: name }), help: null };
    case 'unknown':
      return { heading: tFit('unknownHeading'), help: tFit('unknownHelp') };
    case 'no-fit-exact':
      if (exactCount === null) throw new Error('listing: exact-hit group where the listing has none');
      return {
        heading: tFit('exactHeading'),
        help: tFit('exactHelp', { car: name, count: exactCount }),
      };
  }
}
