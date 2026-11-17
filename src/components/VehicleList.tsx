import { useId } from 'react';

import {
  splitVehicleRows,
  type VehicleGroup,
  type VehicleListRow,
} from './vehicle-list-groups';
import styles from './VehicleList.module.css';

export type { VehicleListRow };

export type VehicleListProps = {
  /** ProductFit.listHeading. */
  heading: string;
  /** ProductFit.listHelp: tells what a row does. */
  help: string;
  /** In vehicle-list order, never empty: the page draws no card for none. */
  rows: VehicleListRow[];
  /** ProductFit.yourCar, the tag on the selected car's row. */
  yourCarLabel: string;
  /** The closed control label with the count behind it; null when nothing collapses. */
  moreLabel: string | null;
  /** ProductFit.fewerVehicles, the open control label. */
  fewerLabel: string;
};

/** One heading and the tiles under it. The heading names the list for assistive technology. */
function Group({ group, yourCarLabel }: { group: VehicleGroup; yourCarLabel: string }) {
  const headingId = useId();
  return (
    <div className={styles.group}>
      <h3 id={headingId} className={styles.groupHeading}>
        {group.groupName}
      </h3>
      <ul aria-labelledby={headingId} className={styles.tiles}>
        {group.rows.map((row) => (
          <li key={row.key} className={styles.item}>
            <a href={row.href} rel="nofollow" className={styles.tile} data-testid="vehicle-list-row">
              <span className={styles.hidden}>{row.groupName}</span>{' '}
              <span className={styles.engineLine}>
                <span className={styles.engine}>{row.engine}</span>
                {row.isSelectedCar ? (
                  <span className={styles.tag} data-testid="vehicle-list-your-car">
                    {yourCarLabel}
                  </span>
                ) : null}
              </span>{' '}
              <span className={styles.detail}>{row.detail}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The vehicles a product fits (S5.9). Display strings only; the page builds every
 * row. The first ten vehicles are shown, the rest sit in a native `details` that
 * works without script and is in the first HTML. Every row is a plain anchor with
 * `rel="nofollow"`: no `next/link`, no target, no script writes the stored car.
 */
export function VehicleList({
  heading,
  help,
  rows,
  yourCarLabel,
  moreLabel,
  fewerLabel,
}: VehicleListProps) {
  const { shown, rest } = splitVehicleRows(rows, moreLabel === null ? rows.length : undefined);
  return (
    <div className={styles.card} data-testid="vehicle-list">
      <h2 className={styles.heading}>{heading}</h2>
      <p className={styles.help}>{help}</p>
      <div className={styles.groups}>
        {shown.map((group, index) => (
          <Group key={`${group.groupKey}-${index}`} group={group} yourCarLabel={yourCarLabel} />
        ))}
      </div>
      {rest.length > 0 && moreLabel !== null ? (
        <details className={styles.more} data-testid="vehicle-list-more">
          <summary className={styles.summary} data-testid="vehicle-list-toggle">
            <span className={styles.moreLabel}>{moreLabel}</span>
            <span className={styles.fewerLabel}>{fewerLabel}</span>
            <span className={styles.chevron} aria-hidden="true" />
          </summary>
          <div className={styles.rest}>
            {rest.map((group, index) => (
              <Group key={`${group.groupKey}-${index}`} group={group} yourCarLabel={yourCarLabel} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
