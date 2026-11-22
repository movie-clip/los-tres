# 0010 — Slice A tooling calls: npm, Node 22, test database, styling

Status: accepted, 2026-10-16. Amended 2026-11-22 (S2, #336, owner ruling D-1 of
run 2026-11-22-test-speed-plan): the test database is now a template plus one
clone per Vitest worker, so integration test files run in parallel. The other
three answers are unchanged.

## Decision

The owner's answers to the four questions the tracer-bullet design raised:

- **Package manager:** npm.
- **Node major:** Node 22.
- **Test database:** no new service. On the existing `db` service, a template
  database `<DB_NAME>_tpl_test`, dropped and migrated from nothing on every
  integration run, and one clone of it per Vitest worker,
  `<DB_NAME>_w<n>_test`. (Amended 2026-11-22, #336; it was a single
  `<DB_NAME>_test`, which the next run still drops if it finds one.) The clones
  stay after a run and the next run drops them. The worker count is
  `min(8, CPUs - 1)`, at least 1, or the optional `INTEGRATION_WORKERS`.
- **Styling:** plain `globals.css` with CSS variables for slice A. The owner
  will choose a styling system before slice B; until then none is chosen.
