# 0010 — Slice A tooling calls: npm, Node 22, test database, styling

Status: accepted, 2026-10-16.

## Decision

The owner's answers to the four questions the tracer-bullet design raised:

- **Package manager:** npm.
- **Node major:** Node 22.
- **Test database:** no new service. A second database, `<DB_NAME>_test`, on the
  existing `db` service.
- **Styling:** plain `globals.css` with CSS variables for slice A. The owner
  will choose a styling system before slice B; until then none is chosen.
