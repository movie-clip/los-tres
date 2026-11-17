import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VehicleList } from '@/components/VehicleList';
import {
  splitVehicleRows,
  VEHICLE_LIST_VISIBLE,
  type VehicleListRow,
} from '@/components/vehicle-list-groups';

// S5.9 T5.9.2 (#280) ACs 16, 19, 20: the collapse boundary counts vehicles, never group headings, and a
// group straddling the boundary is in both halves. The component draws what the page gives it: every row
// when there is no control label, the first ten plus a native details when there is one.

/** `n` rows spread over groups of `sizes` (cycled): g1 rows, then g2 rows, and so on. */
function rowsOf(n: number, sizes: number[] = [n]): VehicleListRow[] {
  const rows: VehicleListRow[] = [];
  let group = 1;
  let inGroup = 0;
  for (let index = 1; index <= n; index += 1) {
    if (inGroup === sizes[(group - 1) % sizes.length]) {
      group += 1;
      inGroup = 0;
    }
    inGroup += 1;
    rows.push({
      key: `v${index}`,
      groupKey: `g${group}`,
      groupName: `Grupo ${group}`,
      engine: `Motor ${index}`,
      detail: `Detalle ${index}`,
      href: `/categoria/filtros?coche=v${index}`,
      isSelectedCar: false,
    });
  }
  return rows;
}

const count = (rows: { rows: unknown[] }[]) => rows.reduce((sum, group) => sum + group.rows.length, 0);

describe('splitVehicleRows: the boundary is 10 vehicles (AC 19)', () => {
  it('the visible count is ten', () => {
    expect(VEHICLE_LIST_VISIBLE).toBe(10);
  });

  it('0 rows: nothing shown, nothing behind the control', () => {
    expect(splitVehicleRows([])).toEqual({ shown: [], rest: [] });
  });

  it('1 row: one group of one row, no rest', () => {
    const { shown, rest } = splitVehicleRows(rowsOf(1));
    expect(shown).toHaveLength(1);
    expect(count(shown)).toBe(1);
    expect(rest).toEqual([]);
  });

  it('exactly 10 rows: all shown, no rest, whatever the number of groups', () => {
    for (const sizes of [[10], [1], [5, 5], [3, 3, 4], [2]]) {
      const { shown, rest } = splitVehicleRows(rowsOf(10, sizes));
      expect(count(shown), `sizes ${sizes}`).toBe(10);
      expect(rest, `sizes ${sizes}`).toEqual([]);
    }
  });

  it('11 rows in one group: ten shown, one behind, and the group is in both halves', () => {
    const { shown, rest } = splitVehicleRows(rowsOf(11, [11]));
    expect(count(shown)).toBe(10);
    expect(count(rest)).toBe(1);
    expect(shown.map((group) => group.groupKey)).toEqual(['g1']);
    expect(rest.map((group) => group.groupKey)).toEqual(['g1']);
    expect(rest[0].rows[0].key).toBe('v11');
  });

  it('11 rows with the break between groups: the heading of a group none of whose rows is shown is only in rest', () => {
    // 10 rows in g1, the 11th alone in g2.
    const { shown, rest } = splitVehicleRows(rowsOf(11, [10, 1]));
    expect(shown.map((group) => group.groupKey)).toEqual(['g1']);
    expect(rest.map((group) => group.groupKey)).toEqual(['g2']);
  });

  it('12 rows with a group straddling the tenth: its heading appears in shown and in rest, rows are not repeated', () => {
    // g1 has 4, g2 has 8: rows 5 to 10 are shown, 11 and 12 are behind, g2 straddles.
    const rows = rowsOf(12, [4, 8]);
    const { shown, rest } = splitVehicleRows(rows);
    expect(shown.map((group) => [group.groupKey, group.rows.length])).toEqual([
      ['g1', 4],
      ['g2', 6],
    ]);
    expect(rest.map((group) => [group.groupKey, group.rows.length])).toEqual([['g2', 2]]);
    expect([...shown, ...rest].flatMap((group) => group.rows.map((row) => row.key))).toEqual(
      rows.map((row) => row.key),
    );
  });

  it('keeps list order and groups only neighbouring runs of one key', () => {
    const rows = rowsOf(4, [1]);
    rows[2].groupKey = rows[0].groupKey;
    rows[2].groupName = rows[0].groupName;
    const { shown } = splitVehicleRows(rows);
    // g1, g2, g1, g4: the repeated key is not merged across a different neighbour.
    expect(shown.map((group) => group.groupKey)).toEqual(['g1', 'g2', 'g1', 'g4']);
  });

  it('honours a limit argument', () => {
    const { shown, rest } = splitVehicleRows(rowsOf(5), 2);
    expect(count(shown)).toBe(2);
    expect(count(rest)).toBe(3);
  });
});

type Props = Parameters<typeof VehicleList>[0];

function list(rows: VehicleListRow[], over: Partial<Props> = {}): string {
  const moreLabel = rows.length > VEHICLE_LIST_VISIBLE ? `Mostrar ${rows.length - 10} vehículos más` : null;
  return renderToStaticMarkup(
    createElement(VehicleList, {
      heading: 'Vehículos compatibles',
      help: 'Ayuda de la lista.',
      rows,
      yourCarLabel: 'Tu coche',
      moreLabel,
      fewerLabel: 'Mostrar menos',
      ...over,
    }),
  );
}

const tiles = (html: string) => html.match(/data-testid="vehicle-list-row"/g)?.length ?? 0;

describe('VehicleList (AC 12, 16, 19, 20, 31)', () => {
  it('one card with the heading as an h2 and the help as a paragraph', () => {
    const html = list(rowsOf(3));
    expect(html.match(/data-testid="vehicle-list"/g)).toHaveLength(1);
    expect(html).toMatch(/<h2[^>]*>Vehículos compatibles<\/h2>/);
    expect(html).toMatch(/<p[^>]*>Ayuda de la lista\.<\/p>/);
  });

  it('with no moreLabel every row is drawn and there is no details and no control', () => {
    const html = list(rowsOf(12), { moreLabel: null });
    expect(tiles(html)).toBe(12);
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
    expect(html).not.toContain('vehicle-list-toggle');
  });

  it('10 rows with a moreLabel given anyway: all ten shown, no details (nothing is behind it)', () => {
    const html = list(rowsOf(10), { moreLabel: 'Mostrar 0 vehículos más' });
    expect(tiles(html)).toBe(10);
    expect(html).not.toContain('<details');
  });

  it('11 rows with a moreLabel: the first ten before the details, the eleventh inside it, both labels in the summary', () => {
    const html = list(rowsOf(11, [11]));
    const at = html.indexOf('<details');
    expect(at).toBeGreaterThan(-1);
    expect(tiles(html.slice(0, at))).toBe(10);
    expect(tiles(html.slice(at))).toBe(1);
    expect(html).toContain('data-testid="vehicle-list-more"');
    expect(html).toMatch(/<summary[^>]*data-testid="vehicle-list-toggle"/);
    expect(html).toContain('Mostrar 1 vehículos más');
    expect(html).toContain('Mostrar menos');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    // The rest part is server-rendered markup (AC 20): the eleventh row's href is in the string.
    expect(html.slice(at)).toContain('coche=v11');
  });

  it('a group straddling the boundary repeats its h3 inside the details', () => {
    const html = list(rowsOf(12, [4, 8]));
    const at = html.indexOf('<details');
    expect(html.slice(0, at).match(/<h3[^>]*>Grupo 2<\/h3>/g)).toHaveLength(1);
    expect(html.slice(at).match(/<h3[^>]*>Grupo 2<\/h3>/g)).toHaveLength(1);
  });

  it('a group none of whose rows is shown has its heading only inside the details (AC 19)', () => {
    const html = list(rowsOf(11, [10, 1]));
    const at = html.indexOf('<details');
    expect(html.slice(0, at)).not.toContain('Grupo 2');
    expect(html.slice(at)).toContain('Grupo 2');
  });

  it('every tile is a plain anchor to the row href with rel nofollow, no target and no script', () => {
    const html = list(rowsOf(11, [11]));
    const anchors = html.match(/<a [^>]*data-testid="vehicle-list-row"[^>]*>/g) ?? [];
    expect(anchors).toHaveLength(11);
    for (const [index, anchor] of anchors.entries()) {
      expect(anchor).toContain(`href="/categoria/filtros?coche=v${index + 1}"`);
      expect(anchor).toContain('rel="nofollow"');
      expect(anchor).not.toContain('target=');
    }
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
  });

  it('puts the Tu coche tag on the selected row only', () => {
    const rows = rowsOf(3);
    rows[1].isSelectedCar = true;
    const html = list(rows);
    expect(html.match(/data-testid="vehicle-list-your-car"/g)).toHaveLength(1);
    const tag = html.indexOf('vehicle-list-your-car');
    expect(html.lastIndexOf('Motor 2', tag)).toBeGreaterThan(html.lastIndexOf('Motor 1', tag));
    expect(html.indexOf('Motor 3')).toBeGreaterThan(tag);
  });

  it('draws no tag when no row is the selected car', () => {
    expect(list(rowsOf(3))).not.toContain('vehicle-list-your-car');
  });

  it('one h3 per group, each naming a list by aria-labelledby, and the group name as text', () => {
    const html = list(rowsOf(6, [2, 4]));
    expect(html.match(/<h3 /g)).toHaveLength(2);
    for (const match of html.matchAll(/<h3 id="([^"]+)"/g)) {
      expect(html).toContain(`aria-labelledby="${match[1]}"`);
    }
  });

  it('escapes the text it is given', () => {
    const rows = rowsOf(1);
    rows[0].engine = '<b>x</b>';
    rows[0].groupName = '"><img src=x>';
    const html = list(rows);
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<img');
  });
});
