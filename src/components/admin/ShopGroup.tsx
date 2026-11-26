'use client';

import type { SourceActionState } from '@/app/admin/(shell)/tiendas/actions';

import {
  SourceRow,
  useSourceRowAction,
  type SourceRowAction,
  type SourceRowExtras,
  type SourceRowLabels,
} from './SourceRow';
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
  extras: SourceRowExtras;
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
  extras: SourceRowExtras;
  /** "Esta tienda aún no tiene feeds.", shown in the feed position when the shop has none. */
  noFeeds: string;
  feeds: FeedRowView[];
};

export type ShopGroupProps = {
  shop: ShopGroupView;
  shopAction: SourceRowAction;
  feedAction: SourceRowAction;
};

type FeedRowProps = {
  feed: FeedRowView;
  feedAction: SourceRowAction;
  /** The shop's current action state: a newer stored result ends this feed's own feedback (#384). */
  shopResult: SourceActionState;
};

/** One feed row, bound to its own action and told its shop's current state. */
function FeedRow({ feed, feedAction, shopResult }: FeedRowProps) {
  const control = useSourceRowAction('feed', feed.id, feedAction);
  return (
    <SourceRow
      kind="feed"
      id={feed.id}
      title={feed.title}
      meta={feed.meta}
      note={feed.note}
      approved={feed.approved}
      paused={feed.paused}
      labels={feed.labels}
      extras={feed.extras}
      control={control}
      shopResult={shopResult}
    />
  );
}

/**
 * A shop in an outlined box, with its feeds as rows inside the same box. It holds
 * the shop row's action state, so the shop's stored result reaches its feed rows
 * in the same render (#384).
 */
export function ShopGroup({ shop, shopAction, feedAction }: ShopGroupProps) {
  const shopControl = useSourceRowAction('shop', shop.id, shopAction);
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
          extras={shop.extras}
          control={shopControl}
        />
      </div>
      {shop.feeds.length > 0 ? (
        <ul className={styles.feeds}>
          {shop.feeds.map((feed) => (
            <li key={feed.id} className={styles.feed}>
              <FeedRow feed={feed} feedAction={feedAction} shopResult={shopControl.state} />
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.feed} data-testid="shop-no-feeds">
          <p className={styles.none}>{shop.noFeeds}</p>
        </div>
      )}
    </li>
  );
}
