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

**Scope.** Rules 1 to 4 apply to the `unit` and `integration` Vitest projects
(`tests/unit`, `tests/integration`, and the shared files in `tests/support`).
The e2e tests are outside rules 1 to 4. Rule 5 is pinned over `vitest.config.mts`,
the `package.json` scripts and `gate.yml`, and, to keep the timing suite out of
every other job, over the text of every file in `.github/workflows/`. The rule 6
pin also reads both Vitest configs, `playwright.config.ts`, the sources in
`tests/e2e` and `tests/timing`, and every workflow. Rule 7 applies to pull
requests, not to test files, and no pin reads it.

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
   and the required `gate.yml` workflow does not. The one workflow job that runs
   them is the `timing` job of the manual `gate-repeat.yml` workflow (rule 7): it
   prints the tables in its summary and does not fail on a slow or failing
   timing, only when its own setup fails. A change to a query they measure runs
   them and records the table in its report.
6. **No test is retried automatically**, locally or on CI: no Vitest `retry`, no
   Playwright `retries` above 0, no retry flag in a script, no retry or
   `continue-on-error` in a workflow. No job lets a failing command pass (a
   shell `||`, `set +e`, a trailing `; true`), except the `timing` job of
   `gate-repeat.yml`, which keeps the exit code of `test:timing` to report it,
   and one line of its `plan` job whose next lines fail the job on anything but
   a 40-character commit. The copies of `gate-repeat` are independent runs the
   owner starts, and its timing job runs the suite twice as two measurements
   (alone, then beside busy loops): neither is a retry.
7. **A pull request that changes how tests execute is repeated before it is
   merged.** The owner starts `gate-repeat` on it (input `pr`): five copies of
   the gate, all green; ten copies when the change touches the worker count, the
   test-database setup or reset, or the CI job layout. The pull request body
   links that run. A red copy is a finding to explain, not a run to start again
   until it passes. "How tests execute" means `vitest.config.mts`,
   `vitest.timing.config.mts`, `playwright.config.ts`,
   `tests/support/global-setup.ts`, `tests/support/test-database-env.ts`,
   `tests/support/env.ts`, `tests/support/db.ts`, `tests/support/isolated-app.ts`,
   `tests/e2e/global-setup.ts`, any file in `.github/workflows/`, the `test*`,
   `gate*`, `db:*` and `stack:*` scripts in `package.json`, and the `db` service
   in `compose.yaml`. Nothing enforces rule 7 by machine: the owner checks it
   before merging and the integration review checks it, and no pin reads a pull
   request's body or diff. A change from a file outside that list that alters
   execution (a test that opens its own connection pool, for example) is not
   caught by the list; the integration review names it.

   **The case rule 7 cannot cover.** A manual workflow cannot be started until
   its file is on `main` (GitHub's rule for `workflow_dispatch`), so a pull request that adds or changes `gate-repeat.yml` cannot
   be repeated before it is merged, and neither can any use of the workflow
   before the file is on `main`. A change to the steps or job settings of
   `gate.yml` is the same case, because the drift pin requires `gate-repeat.yml`
   to change with them. With `pr` set, the jobs check out the pull request's
   merge commit, so the copies run that commit's code, tests, `package.json`
   scripts and pins, and the pins read the pull request's workflow files as
   text. What they do not run is the pull request's own `gate-repeat.yml` as a
   workflow: `plan`, `copy` and `timing` execute as written in the file the
   dispatch started from, not as written in the pull request's merge commit. For such a pull request the owner merges on the `gate`
   check and starts the repeat run on `main` afterwards.

**What enforces them.**

| Rule | Checked by |
|---|---|
| 1, 2 | ESLint, the `no-restricted-syntax` block for `tests/unit`, `tests/integration` and `tests/support` in `eslint.config.mjs`, with `reportUnusedDisableDirectives` as an error; `tests/timing` and `tests/e2e` are left out of the block. Pinned by `tests/unit/eslint-guardrails.test.ts`. |
| 2 | The directive form is also held by `tests/unit/gate-determinism.test.ts`, which fails on any other `eslint-disable` or inline setting that covers the rule. |
| 5 | `tests/unit/gate-determinism.test.ts`, pinned: no project of `vitest.config.mts` includes `tests/timing`; no script the gate reaches, by a call, a `pre` or `post` hook or an install step, runs the timing config; `gate.yml` does not name it; and no job of any workflow but the `timing` job of `gate-repeat.yml` runs or names the timing suite (`test:timing`, `vitest.timing`, `tests/timing`, `.timing.test`), while that job does run `npm run test:timing`. The pins read `package.json` and workflow text only. |
| 5 (the `timing` job) | Review, not pinned: that the job is report-only. The pin lets the job swallow a failure; none requires it to. A job that reaches the suite through a script the pins do not walk (a workflow step calling another npm script) is not seen. |
| 6 | `tests/unit/gate-determinism.test.ts`, pinned: neither Vitest config sets `retry`, `playwright.config.ts` sets no `retries` above 0, no `package.json` script has a retry flag, no test source (`tests/unit`, `integration`, `support`, `e2e`, `timing`) asks for a retry, and no line of any workflow has `retry`, `retries`, `rerun` or `continue-on-error`. In every job of every workflow but `gate-repeat.yml`'s `timing`, no line has a shell `\|\|`, `set +e`, a trailing `; true`, `; :` or `; exit 0`, a bare `exit 0` or a custom `shell: ... {0}`; the one line allowed is the `\|\| sha=''` of `plan`, and a second pin holds the check after it. |
| 6 (limits) | Review, not pinned: a failure swallowed with no pinned word (a pipe into `tee`, `cmd &` then `wait`, a `trap` that changes the status, `if cmd; then :; fi`, a script file a step calls). |
| 7 (copies equal the gate) | `tests/unit/gate-determinism.test.ts`, pinned: the steps of the `copy` job in `gate-repeat.yml` equal those of the `gate` job in `gate.yml`, step by step, the checkout `ref` from `plan` being the one allowed difference and present once; every other job setting but `name`, `needs` and `strategy` is equal, `timeout-minutes` included; neither workflow sets top-level `env` or `defaults`. The pins read text with no YAML parser. |
| 7 (the check name, the trigger) | `tests/unit/gate-determinism.test.ts`, pinned: `gate.yml` has one check, named `gate`; no job of `gate-repeat.yml` has the id or the name `gate`, and the workflow is not named `gate`; its only trigger is `workflow_dispatch`. Review, not pinned: a check name built by an expression, a job named `gate` through a YAML anchor or merge key, a reusable-workflow job, another workflow that dispatches this one, an `on:` written as an inline mapping (the pin fails closed on it). |
| 7 (never required) | Review, not pinned: that `gate-repeat` is not a required check and `gate` is. That is the branch ruleset on GitHub, which the owner holds. |
| 7 (the rule itself) | The owner before merging, and the integration review. Nothing is checked by machine: no pin reads a pull request's diff or body, and a repeat run is never a gate step. |
| 3, 4 | The integration review only. Nothing machine-checks a sleep or a timeout. |
| 5 (the table in the report) | The integration review only. |

**Known limits.** The lint matches the five forms by name, so it has false
negatives (aliased or computed access such as `Date['now']` or
`const { now } = Date`, SQL time functions such as `now()`, and sleeps); the
integration review covers them.
