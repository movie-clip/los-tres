import { SourceRow, type SourceRowLabels, type SourceRowProps } from './SourceRow';
import styles from './ShopGroup.module.css';

/** One feed, with every string already translated. */
export type FeedRowView = {
  id: number;
  title: string;
  meta: string;
  /** The "En pausa" line, or null. */
  note: string | null;
  approved: boolean;
  /** Approved while its shop is not. */
  paused: boolean;
  labels: SourceRowLabels;
};

/** One shop and its feeds, with every string already translated. */
export type ShopGroupView = {
  id: number;
  title: string;
  meta: string;
  /** The group note, or null. */
  note: string | null;
  approved: boolean;
  labels: SourceRowLabels;
  feeds: FeedRowView[];
};

export type ShopGroupProps = {
  shop: ShopGroupView;
  shopAction: SourceRowProps['action'];
  feedAction: SourceRowProps['action'];
};

/** A shop in an outlined box, with its feeds as rows inside the same box. */
export function ShopGroup({ shop, shopAction, feedAction }: ShopGroupProps) {
  return (
    <li className={styles.box}>
      <div className={styles.shop}>
        <SourceRow
          kind="shop"
          id={shop.id}
          title={shop.title}
          meta={shop.meta}
          note={shop.note}
          approved={shop.approved}
          paused={false}
          labels={shop.labels}
          action={shopAction}
        />
      </div>
      {shop.feeds.length > 0 ? (
        <ul className={styles.feeds}>
          {shop.feeds.map((feed) => (
            <li key={feed.id} className={styles.feed}>
              <SourceRow
                kind="feed"
                id={feed.id}
                title={feed.title}
                meta={feed.meta}
                note={feed.note}
                approved={feed.approved}
                paused={feed.paused}
                labels={feed.labels}
                action={feedAction}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
