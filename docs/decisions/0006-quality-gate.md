# 0006 — Quality gate: ESLint, tsc, Vitest, Playwright

Status: accepted, 2026-10-12. Revised 2026-10-16 for the price-comparison
scope. Amended 2026-11-23: time in tests (the last section).

## Decision

The gate every slice must pass:

- **ESLint** for lint
- **`tsc --noEmit`** for types
- **Vitest** for unit and integration tests, integration tests against a real
  PostgreSQL
- **Playwright** for the key flows end to end:
  - search → product page → offers sorted by price → the `/go/<offer>`
    redirect logs the click and lands on the affiliate URL;
  - an admin approves a feed, runs "Import now" and reads the import report;
  - an admin resolves a matching-queue item and uploads a product image.

The first slice that adds code puts the exact commands in `CLAUDE.md` §
Commands.

## Why

`CLAUDE.md` requires a lint and a test command as the gate. These are the
standard tools for TypeScript and Next.js, and agents know them well.

## Consequences

Each guardrail gets tests of its own:

- offers from an unapproved feed, and hidden products or offers, are never
  public;
- the importer refuses any source that is not a registered feed;
- admin routes reject anonymous requests on the server;
- money stays in integer cents;
- the click log holds no IP, user agent or cookie.

Tests import from local fixture feed files and never call a live network.

## Amendment 2026-11-23: time in tests

Owner ruling, run 2026-11-23-no-clock-in-gate (issue #348). The gate's result
must not depend on how fast or how loaded the machine is.

**Scope.** The rules apply to the `unit` and `integration` Vitest projects
(`tests/unit`, `tests/integration`, and the shared files in `tests/support`).
The e2e tests are outside them.

1. **No test decides its result by reading the clock.** `Date.now()`,
   `performance.now()`, `process.hrtime`, `process.uptime()` and `new Date()`
   with no argument are not used, and no assertion compares an elapsed time with
   a limit. A cost is asserted on what the machine's speed cannot change, such as
   the number of queries or the bytes pulled from a source.
2. **A stored time compared with the present** (a click time, a session end)
   uses fake timers, or a window of at least one minute, and the line carries
   exactly this directive, with a reason of at least ten characters:
   `// eslint-disable-next-line no-restricted-syntax -- clock: <why load cannot reach it>`.
   No other way of switching the rule off is accepted: not a same-line or
   file-level directive, not a bare one, not a rule list, not an inline
   `eslint no-restricted-syntax` setting.
3. **No fixed sleep decides a result.** A test waits for a state it can observe,
   such as a lock wait in `pg_stat_activity` or a promise the code under test
   resolves.
4. **A timeout guards against a hang; it is not a speed requirement.** It is set
   at least ten times above the test's duration on the development machine. A
   file-level `testTimeout` setting (`vi.setConfig`) counts, as does a number on
   one test.
5. **Real timings live in `tests/timing/`** and run with `npm run test:timing`
   (`vitest.timing.config.mts`, one worker), on demand. No gate step runs them,
   and the required `gate.yml` workflow does not. A change to a query they
   measure runs them and records the table in its report.
6. **No test is retried automatically**, locally or on CI: no Vitest `retry`, no
   Playwright `retries` above 0, no retry flag in a script, no retry or
   `continue-on-error` in a workflow.

**What enforces them.**

| Rule | Checked by |
|---|---|
| 1, 2 | ESLint, the `no-restricted-syntax` block for `tests/unit`, `tests/integration` and `tests/support` in `eslint.config.mjs`, with `reportUnusedDisableDirectives` as an error; `tests/timing` and `tests/e2e` are left out of the block. Pinned by `tests/unit/eslint-guardrails.test.ts`. |
| 2 | The directive form is also held by `tests/unit/gate-determinism.test.ts`, which fails on any other `eslint-disable` or inline setting that covers the rule. |
| 5 | `tests/unit/gate-determinism.test.ts`: no project of `vitest.config.mts` includes `tests/timing`, no script the gate reaches runs the timing config, and `gate.yml` does not name it. The pin covers `package.json` and `gate.yml` text only. |
| 6 | `tests/unit/gate-determinism.test.ts`: both Vitest configs, `playwright.config.ts`, the `package.json` scripts, the workflows and the test sources. |
| 3, 4 | The integration review only. Nothing machine-checks a sleep or a timeout. |
| 5 (the table in the report) | The integration review only. |

**Known limits.** The lint matches the five forms by name, so it has false
negatives (aliased or computed access such as `Date['now']` or
`const { now } = Date`, SQL time functions such as `now()`, and sleeps); the
integration review covers them.
