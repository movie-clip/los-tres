# 0015 — Fixed category tree created by migrate, from code

Status: accepted, 2026-10-27. The owner approved the mechanism on 2026-10-27
(run 2026-10-26-s4-0-fixed-category-tree, S4.0).

## Decision

- The category tree is fixed and defined once, in `src/db/category-tree.ts`:
  the root `mantenimiento-del-coche` and five children, `aceite-de-motor`,
  `filtros-de-aceite`, `filtros-de-aire`, `filtros-de-combustible` and
  `filtros-de-habitaculo`.
- `runMigrations` applies the SQL migrations and then calls
  `ensureFixedCategoryTree`, which upserts the six rows on `slug` in one
  transaction, setting name, parent and position. It never deletes. Every
  migrate path runs it (the container start, the `migrate` verb,
  `npm run db:migrate` and the integration-test setup), whatever
  `SEED_DEMO_DATA` says.
- The seed creates no category. It inserts the demo feed-category mappings onto
  the fixed slugs and fails if a fixed slug is missing.
- The slugs are frozen: they are public URLs (`/categoria/<slug>`). Changing
  one is a new decision.
- Migration `0004_retire_legacy_demo_categories` deletes the seven legacy demo
  categories (`automovil`, `herramientas`, `aceites-y-lubricantes`, `filtros`,
  `escobillas-y-bombillas`, `herramientas-electricas`, `herramientas-manuales`)
  on every database, once: it clears the category of products in them, deletes
  their feed-category mappings, then deletes the categories. Their
  `/categoria/<slug>` URLs answer 404 with no redirect.

## Why

- One source in code serves every database, and the tests reuse the same
  function instead of repeating the rows in SQL.
- A name or position fix is a code change, applied on the next start, not
  another data migration.
- Tying it to the seed would leave a server without `SEED_DEMO_DATA` with no
  categories, and so no public catalogue.

## Consequences

- A hand edit of a fixed category in the database is overwritten on the next
  migrate. If an admin editor is added later, it has to account for this.
- Products that were in a retired category become unmapped, and so not public,
  until the next `import-feeds` assigns them a category through a mapping.
- Tests start from the migrated state: `resetDatabase` re-creates the tree
  after truncating, so the six fixed categories take ids 1 to 6.
- The tree editor (S4.1) is replaced by this fixed tree; mapping feed
  categories to the five children stays with S4.2.
