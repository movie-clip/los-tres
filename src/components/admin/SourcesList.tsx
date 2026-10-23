import { ShopGroup, type ShopGroupView } from './ShopGroup';
import type { SourceRowProps } from './SourceRow';
import styles from './SourcesList.module.css';

export type SourcesListProps = {
  /** Accessible name of the list, "Tiendas y sus feeds". */
  label: string;
  shops: ShopGroupView[];
  /** The two server actions, passed down by the page: this component imports nothing from src/server. */
  shopAction: SourceRowProps['action'];
  feedAction: SourceRowProps['action'];
};

/** The shops, in the order given, each with its feeds. Display strings only. */
export function SourcesList({ label, shops, shopAction, feedAction }: SourcesListProps) {
  return (
    <ul className={styles.list} aria-label={label} data-testid="sources-list">
      {shops.map((shop) => (
        <ShopGroup key={shop.id} shop={shop} shopAction={shopAction} feedAction={feedAction} />
      ))}
    </ul>
  );
}
