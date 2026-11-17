import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { fitMarkKind, FitMark } from '../../src/components/FitMark';
import { ListingGroup, groupRuns, type ListingGroupKind, type ListingGroupProps } from '../../src/components/ListingGroup';

// S5.8 (#276): the two pure helpers of the grouped listing, and the markup contract of the
// two components. The page renders one ListingGroup per run, so a run list that merged or
// reordered groups would repeat or drop a heading.

const groupOf = (item: { group: ListingGroupKind }): ListingGroupKind => item.group;
const card = (group: ListingGroupKind, name: string) => ({ group, name });

describe('groupRuns', () => {
  it('returns no run for an empty list, so no heading renders', () => {
    expect(groupRuns([], groupOf)).toEqual([]);
  });

  it('puts a single group in one run', () => {
    const items = [card('fits', 'a'), card('fits', 'b')];
    expect(groupRuns(items, groupOf)).toEqual([{ group: 'fits', items }]);
  });

  it('splits a list at each change of group, in the order given', () => {
    const items = [card('fits', 'a'), card('fits', 'b'), card('unknown', 'c'), card('unknown', 'd')];
    const runs = groupRuns(items, groupOf);
    expect(runs.map((run) => run.group)).toEqual(['fits', 'unknown']);
    expect(runs.map((run) => run.items.map((item) => item.name))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps the card order inside a run', () => {
    const items = [card('unknown', 'z'), card('unknown', 'a'), card('unknown', 'm')];
    expect(groupRuns(items, groupOf)[0].items.map((item) => item.name)).toEqual(['z', 'a', 'm']);
  });

  it('starts a new run when a group returns after another, never merging non-adjacent cards', () => {
    const items = [card('fits', 'a'), card('unknown', 'b'), card('fits', 'c')];
    expect(groupRuns(items, groupOf).map((run) => run.group)).toEqual(['fits', 'unknown', 'fits']);
  });

  it('handles all three groups, one run each', () => {
    const items = [card('fits', 'a'), card('unknown', 'b'), card('no-fit-exact', 'c')];
    expect(groupRuns(items, groupOf).map((run) => run.group)).toEqual(['fits', 'unknown', 'no-fit-exact']);
  });

  it('loses no item', () => {
    const items = [card('fits', 'a'), card('unknown', 'b'), card('unknown', 'c'), card('no-fit-exact', 'd')];
    expect(groupRuns(items, groupOf).flatMap((run) => run.items)).toEqual(items);
  });
});

describe('fitMarkKind', () => {
  it('maps fits to the compatible mark', () => {
    expect(fitMarkKind('fits')).toBe('fits');
  });

  it('maps an exact-code hit that does not fit to the no-fit mark', () => {
    expect(fitMarkKind('no-fit-exact')).toBe('no-fit');
  });

  it('gives a no-data card no mark', () => {
    expect(fitMarkKind('unknown')).toBeNull();
  });

  it('gives a card with no group (no car) no mark', () => {
    expect(fitMarkKind(null)).toBeNull();
  });
});

describe('FitMark and ListingGroup markup', () => {
  it('renders the mark as text with a hidden glyph, an id and the kind', () => {
    const html = renderToStaticMarkup(createElement(FitMark, { kind: 'fits', label: 'Compatible', id: 'm1' }));
    expect(html).toContain('id="m1"');
    expect(html).toContain('data-fit="fits"');
    expect(html).toContain('data-testid="fit-mark"');
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>/);
    expect(html).toContain('Compatible');
  });

  it('renders the no-fit kind', () => {
    const html = renderToStaticMarkup(createElement(FitMark, { kind: 'no-fit', label: 'No compatible', id: 'm2' }));
    expect(html).toContain('data-fit="no-fit"');
  });

  it('names the section by its h2 and shows the help line only when given', () => {
    const withHelp = renderToStaticMarkup(
      createElement(ListingGroup, { group: 'unknown', heading: 'Sin datos', help: 'Compruébalo' } as ListingGroupProps, 'x'),
    );
    expect(withHelp).toContain('data-group="unknown"');
    expect(withHelp).toMatch(/<h2 id="([^"]+)"[^>]*>Sin datos<\/h2>/);
    const id = /<h2 id="([^"]+)"/.exec(withHelp)?.[1];
    expect(withHelp).toContain(`aria-labelledby="${id}"`);
    expect(withHelp).toContain('data-testid="listing-group-help"');

    const without = renderToStaticMarkup(createElement(ListingGroup, { group: 'fits', heading: 'Compatibles' } as ListingGroupProps, 'x'));
    expect(without).not.toContain('listing-group-help');
  });
});
