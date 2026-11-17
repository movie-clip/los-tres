/** How many vehicles of the list are shown before the collapse control (S5.9). */
export const VEHICLE_LIST_VISIBLE = 10;

/**
 * One vehicle of the product's list, finished: the page builds it from the server's
 * FittedVehicle and the messages, the component only draws it.
 */
export type VehicleListRow = {
  /** The vehicle slug: a stable React key, never shown. */
  key: string;
  /** The model slug: a heading starts wherever it changes between neighbouring rows. */
  groupKey: string;
  /** Finished heading text, for example "Seat León III". */
  groupName: string;
  /** The first line of the tile, for example "1.6 TDI". */
  engine: string;
  /** The second line of the tile, for example "Diésel · 115 CV · 2012–2020". */
  detail: string;
  /** Finished href to the product's category for this row's vehicle. */
  href: string;
  /** True on the selected car's row: it carries the "Tu coche" tag. */
  isSelectedCar: boolean;
};

export type VehicleGroup = {
  groupKey: string;
  groupName: string;
  rows: VehicleListRow[];
};

/** Runs of neighbouring rows with the same group key, in order. */
function groupRows(rows: VehicleListRow[]): VehicleGroup[] {
  const groups: VehicleGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.groupKey === row.groupKey) {
      last.rows.push(row);
    } else {
      groups.push({ groupKey: row.groupKey, groupName: row.groupName, rows: [row] });
    }
  }
  return groups;
}

/**
 * Splits the list by vehicle count, not by group: the first `limit` rows are shown,
 * the rest sit behind the control. A group that straddles the limit appears in both
 * halves, so the rest part repeats its heading. At `limit` rows or fewer, `rest` is [].
 */
export function splitVehicleRows(
  rows: VehicleListRow[],
  limit: number = VEHICLE_LIST_VISIBLE,
): { shown: VehicleGroup[]; rest: VehicleGroup[] } {
  return { shown: groupRows(rows.slice(0, limit)), rest: groupRows(rows.slice(limit)) };
}
