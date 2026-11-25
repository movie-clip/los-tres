# 0018 — Offer removal on import, with a guard

Status: accepted, 2026-11-22. Builds on 0013 (a failed import rolls back).

## Decision

- **Removal is a flag, not a delete.** An offer absent from a feed's import is
  marked `offers.is_removed = true` and leaves every public surface through the
  one visibility scope, as a hidden offer does. The row stays because
  `clicks.offer_id` is `on delete restrict` (0009), and so that a returning
  offer keeps its id, its clicks and its product. The flag is a boolean, not a
  timestamp.
- **What counts as seen.** Only accepted rows. An offer of the feed whose
  external id is not among them is removed, including an offer whose row in
  this file failed validation (bad price, link, currency, EAN or title): the
  stored price came from an older file, and the shop's current row says it is
  not usable. A `duplicate_id` row keeps its offer; a row with no id names none.
- **Scope.** The pass touches only the offers of the feed being imported. A
  feed that failed removes nothing, because its transaction rolls back. A
  skipped or unapproved feed gets no pass.
- **Empty-import guard.** An import with no accepted row removes nothing and is
  reported `removal: skipped empty_import`. It cannot be overridden; an admin
  takes a whole feed off by unapproving it.
- **Small-import guard.** An import that would remove 10 offers or more **and**
  more than 50% of the feed's current (not removed) offers removes nothing and
  is reported `removal: skipped small_import`. Exactly half is allowed. The
  numbers are the owner's.
- **Override.** `import-feeds --feed <id> --allow-large-removal` lifts
  `small_import` for that one feed. It is accepted only after `--feed <id>`,
  and never lifts `empty_import`.
- **A skip is not a failure.** The import still commits its other writes,
  prints `  removal: skipped <reason> missing=<n> current=<n>` as the last line
  under its feed, and does not change the exit code. Exit 1 stays "a feed
  failed".
- **Return.** An offer whose row is accepted again gets `is_removed = false`
  in the same upsert, with the same id and clicks.
- **Hide is never written.** The pass and the restore write `is_removed` only;
  never `is_hidden` or the matching-queue flag. A removed offer that was hidden
  stays hidden on return, and unhiding a removed offer publishes nothing.
- **Demo and catalogue-file feeds** follow the same rule.
- **`hasNonDemoOfferWhere`** still counts a removed real offer, as it counts a
  hidden one. Since S12.2 the function is `indexableProductWhere`
  (`src/server/catalogue/demo.ts`): it counts an offer from a feed that is neither
  demo nor collected, in any offer state, so this line stays true.

## Why

- A feed's old offers must not stay on the site once the shop stops listing
  them: a price the shop no longer states is the harm to stop.
- The import is manual and a file can be truncated or its ids changed; the
  guards stop one bad file from emptying a shop, and the override covers a real
  shrink, which would otherwise keep stale offers public for good.

## Considered

- **Deleting the row.** Not possible while clicks reference it; a flag also
  makes return trivial.
- **A `removed_at` timestamp.** Not chosen: nothing in the MVP reads when.
- **No override.** Not chosen: the guard compares with the same current set on
  every run, so a feed that truly shrank would be stuck.
- **Keeping the offer of a rejected row.** Not chosen: it shows an old price.

## Consequences

- Migration 0009 adds `offers.is_removed boolean NOT NULL DEFAULT false`;
  existing offers read false.
- `visibleOfferWhere()` gains "not removed"; no other reader changes.
- The importer is the only writer of `is_removed`.
- The per-feed line gains `offers_removed=<n>` after `offers_updated`.
- Fitments of a feed stay on a product after its offer is removed. This is
  settled under OD-3 (US-5.6): a product dropped from a feed keeps that feed's
  fitments, and a removed offer does not change it.
- The admin offer list shows a removed offer as not on the site with no
  reason. Showing why is tracked in issue #344, not part of this decision.
  Reconciled: S2.5 (#344) delivers the reason; a removed offer now says its
  feed no longer had it in the last import.
- Changing the numbers or the override is an owner decision, not a code edit.
