# 0006 — Quality gate: ESLint, tsc, Vitest, Playwright

Status: accepted, 2026-10-12. Revised 2026-10-16 for the price-comparison
scope. Amended 2026-11-23: time in tests (below). Amended 2026-11-24: test
levels, the fast check and budgets (the last section).

## Decision

The gate every slice must pass:

- **ESLint** for lint
- **`tsc --noEmit`** for types
- **Vitest** for unit and integration tests, integration tests against a real
  PostgreSQL
- **Playwright** for what only a browser or the built server can show, as the
  2026-11-24 amendment lists (rule 12); it replaces the key flows first listed
  here.

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
   `gate*`, `check*`, `db:*` and `stack:*` scripts in `package.json`, and the `db` service
   in `compose.yaml`. Nothing enforces rule 7 by machine: the owner checks it
   before merging and the integration review checks it, and no pin reads a pull
   request's body or diff. A change from a file outside that list that alters
   execution (a test that opens its own connection pool, for example) is not
   caught by the list; the integration review names it.

   **The case rule 7 cannot cover.** Two pull requests cannot be repeated
   before they are merged: the one that adds `gate-repeat.yml` while the file is
   not yet on `main` (a manual workflow cannot be started until its file is on
   the default branch), and a pull request from a fork that changes
   `gate-repeat.yml` or `gate.yml`. For those the owner merges on the `gate`
   check and starts the repeat run on `main` afterwards.

   A same-repository pull request that changes `gate-repeat.yml`, or the steps or
   job settings of `gate.yml` (the drift pin requires `gate-repeat.yml` to change
   with them), is repeated by starting `gate-repeat` on the pull request's own
   branch with `pr` set to its number. The jobs run as written in the file the
   dispatch started from, so that branch's `gate-repeat.yml` runs, and every job
   checks out the pull request's merge commit, so the copies run that commit's
   code, tests, `package.json` scripts and pins. Started on `main` instead, the
   jobs run `main`'s `gate-repeat.yml`, not the pull request's. That a dispatch
   uses the workflow file at the branch it is started from is expected from
   GitHub's documentation; neither the repository nor a run has shown it, and
   the first such dispatch will confirm it.

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
| 7 (what `pr` tests) | `tests/unit/gate-determinism.test.ts`, pinned: `plan` writes its outputs (`attempts`, `ref`) from two lines only, assigns `ref` only as `''` or, after the merge-commit check and its `exit 1`, the 40-character commit, and writes no `GITHUB_ENV`, `GITHUB_PATH` or `set-output`; the `ref` output is wired from `plan`'s own step; and every checkout of every job but `plan` takes exactly `ref: ${{ needs.plan.outputs.ref }}`, so all jobs test one commit. Review, not pinned: that this merge ref is what `gate` tests, that `git ls-remote` works on a real pull request, and a `ref` set by `read`, `printf -v`, `eval` or a script file a step calls. |
| 7 (inputs) | `tests/unit/gate-determinism.test.ts`, pinned: `plan` tests `runs` and `pr` with a bash `[[ $X =~ ^...$ ]]` over the whole value, and the pattern, run as a JavaScript RegExp, takes and refuses the sample values listed in the test; no input goes through `grep`; each check is followed by an `::error` line and `exit 1`, in the order `runs`, `pr`, `git ls-remote`, matrix. Review, not pinned: that bash `=~` behaves as the RegExp does; no test runs bash, so the first dispatch is the check. |
| 7 (permissions, secrets) | `tests/unit/gate-determinism.test.ts`, pinned: `gate-repeat.yml` has one top-level `permissions` block that is exactly `contents: read`, no job sets its own, and no line names `secrets`. Review, not pinned: the repository's own Actions settings on GitHub (fork pull request approval, default token permissions), which the owner holds. |
| 7 (copies run side by side) | `tests/unit/gate-determinism.test.ts`, pinned: the `copy` strategy has `fail-fast: false` and its matrix from `plan`, and sets no `max-parallel`. Review, not pinned: `matrix.include`, `matrix.exclude` or an extra matrix axis, a second matrix job, and the workflow `concurrency` setting. |
| 7 (never required) | Review, not pinned: that `gate-repeat` is not a required check and `gate` is. That is the branch ruleset on GitHub, which the owner holds. |
| 7 (the rule itself) | The owner before merging, and the integration review. Nothing is checked by machine: no pin reads a pull request's diff or body, and a repeat run is never a gate step. |
| 3, 4 | The integration review only. Nothing machine-checks a sleep or a timeout. |
| 5 (the table in the report) | The integration review only. |

**Known limits.** The lint matches the five forms by name, so it has false
negatives (aliased or computed access such as `Date['now']` or
`const { now } = Date`, SQL time functions such as `now()`, and sleeps); the
integration review covers them.

## Amendment 2026-11-24: test levels, the fast check and budgets

Owner rulings of 2026-11-22 (the body of issue #338), 2026-11-23 (the comment
"growth control") and 2026-11-23 (the comment "UI test rule"); issue #338. The
rules continue the numbering of the amendment above.

8. **The fast check.** `npm run check` runs `lint`, `typecheck`, `db:up` and
   all of Vitest (`npm test`, both projects, every file): no image build, no
   Playwright, no changed-files subset. Build lanes verify with it while they
   build. The full `npm run gate` runs at the integration review, before every
   pull request and in CI, and decides "done". `gate` and `gate:ci` start with
   `npm run check`, so the shared steps have one definition. The scripts read:
   `"check": "npm run lint && npm run typecheck && npm run db:up && npm test"`,
   `"gate": "npm run check && npm run stack:up && npm run test:e2e"` and
   `"gate:ci": "npm run check && npm run stack:up && npm run test:e2e:ci"`.
9. **The test level.** A behaviour is tested at the lowest level that can
   observe it.
   - Unit: pure logic, static renders and repository scans.
   - Integration: anything observable by calling a page, handler, action or CLI
     in-process against PostgreSQL.
   - E2E: what needs a browser, or the built server or image: headers from
     `next.config.ts`, proxy rewrites, Set-Cookie on the wire, entrypoint
     verbs.
10. **One test per behaviour.** A behaviour has one level. An acceptance
    criterion is proved once, at the lowest level rule 9 allows; a second test
    of it at a higher level needs a reason written in the story's test report.
    The standing exception is one smoke e2e per page family (rule 11).
11. **UI tests assert behaviour and structure, not presentation.** The site is
    an MVP whose look will change often: a UI test fails only when a visitor or
    admin would lose something, never because a page was restyled or
    rearranged. An e2e test may be:
    - a smoke test, one per page family: the page loads with the right status,
      the ARIA snapshot (`toMatchAriaSnapshot`) of its main region matches, and
      the browser console has no error. A snapshot covers one region, never the
      whole page, and uses patterns for values that change (prices, counts,
      dates). The page families are home, category, product, search, car
      picker, legal pages, 404, admin sign-in, admin shops and feeds, admin
      products and admin categories;
    - a journey (rule 12);
    - a built-server check, as rule 9 describes;
    - a guardrail e2e, frozen: `admin.spec.ts`, `search-privacy.spec.ts` and the
      unapproved-feed mapping test of `admin-categories.spec.ts` (issue #339);
    - one reflow check per public page family: no sideways scroll at 390 px.
      It is the only geometry assertion allowed.

    An e2e test may not be a pixel or geometry assertion (a height, width,
    position, line count or same-row check); a test of one element's presence,
    label or text, which the ARIA snapshot of its region covers; or a second
    copy of behaviour a lower level already proves. Locators go by role and
    accessible name first; `data-testid` only where no role or name identifies
    the element. Message text that is logic (plurals, formatting) stays tested
    at unit level. Outside this rule, for a later owner call: screenshot
    comparison, until the design settles, and an automated accessibility scan
    (axe), because it is a new dependency. Existing specs are brought under the
    rule by issue #339. Until then no new `@layout` test is written, and the
    existing tag and `test:e2e:ci` stay.
12. **The journeys.** The e2e journeys are the list below, 12 entries; a new
    journey is added by a story that names it. This list corrects the key flows
    the Decision first named: it keeps the first, corrects the second and
    removes two entries whose features are deferred.
13. **Budgets.** On the dev machine, the one where `npm run gate` is the gate:
    `check` 90 s, integration 60 s, e2e 90 s, full gate 4 min. Each is measured
    with `time` on the command alone, in that order after the build is final,
    on a warm Docker and database: `npm run check`, `npm run test:integration`,
    `npm run gate`, then `npm run test:e2e` against the stack the gate left up.
    Nothing else heavy runs during a measurement, and the report records the CPU
    count and `INTEGRATION_WORKERS`. The e2e and full-gate budgets are
    provisional until issue #363 lands: they are reported, and rule 14 applies
    to them from that merge, when both are measured again.
14. **Budgets are checked.** The integration review reports the measured
    `check`, integration, e2e and full-gate times next to the budgets. A story
    that takes a step over its budget trims in the same pull request or stops
    for an owner ruling; it is not merged over budget silently.
15. **Counts per story.** The integration review states the tests added and
    removed per level (unit, integration, e2e). Runner totals at HEAD come from
    the `Tests` lines of `npm run test:unit` and `npm run test:integration` and
    from `npx playwright test --list`. Added and removed come from the
    declarations in the diff against `main`, which undercount parametrised
    tests; the report says so beside the numbers.

### Journeys

Each entry names the spec that holds it today.

| # | Journey | Today in |
|---|---|---|
| J1 | search, product page, offers sorted by price, `/go/<offer>` logs the click and redirects | `search.spec.ts`, `product.spec.ts`, `go.spec.ts` |
| J2 | home, category, product through the category tree | `home.spec.ts`, `category.spec.ts`, `product.spec.ts` |
| J3 | header search from a public page to `/buscar` | `header-search.spec.ts` |
| J4 | car selection in the dialog, by mouse and keyboard, then a listing for that car | `car-dialog.spec.ts`, `category-car.spec.ts` |
| J5 | car selection with JavaScript off through `/mi-coche` and back | `car-picker-nojs.spec.ts` |
| J6 | the stored car restored on a later visit, and removed | `car-storage.spec.ts` |
| J7 | with a car: listing to product with its fit banner, `coche` kept on links and through the click-out | `car-links.spec.ts`, `product-fit.spec.ts`, `car-cross-cutting.spec.ts` |
| J8 | admin sign-in, a refused sign-in, sign-out (also a guardrail e2e) | `admin.spec.ts` |
| J9 | an admin registers a shop and a feed through the forms and approves them | `admin-feeds.spec.ts`, `admin-sources.spec.ts`, `collected-admin.spec.ts` |
| J10 | an admin maps a feed category | `admin-categories.spec.ts` |
| J11 | an admin hides and unhides a product, and the public page follows | `admin-products.spec.ts` |
| J12 | catalogue file: file placed, feed registered, two approvals, `import-feeds`, mapping, public product, removal | `catalogue-file-flow.spec.ts` |

J9 corrects the earlier second flow: approving a feed is live, but "Import now"
and the stored import report are deferred (`CLAUDE.md` § Stack, data source;
`docs/product/mvp.md`, S3.2); the import is the `import-feeds` command.

Two entries of the earlier key flows are removed because their features are
deferred:

- "an admin resolves a matching-queue item": the review queue is deferred (0008;
  `docs/product/mvp.md`, S7.2).
- "an admin uploads a product image": product images are deferred
  (`docs/product/mvp.md`, S8.1).

**Not weakened.** Each of the five guardrails keeps its failing-if-broken tests
at their current levels. The guardrails, money, visibility, import and matching
keep their tests at integration level, and message text that is logic stays at
unit level. `gate` keeps every step it has today.

**What enforces them.**

| Rule | Checked by |
|---|---|
| 8 (the steps) | `tests/unit/gate-determinism.test.ts`, pinned: `check` expands to `lint`, `typecheck`, `db:up`, `test` in order; nothing reached from it, hooks included, is `stack:up`, an e2e run, `build`, `dev` or text with `playwright` or `--build`; `scripts.test` is `vitest run`; `gate` and `gate:ci` expand to the steps of `check` plus `stack:up` and `test:e2e` (`test:e2e:ci`); each of the three is bare npm calls joined by `&&`. The walk of rule 5 now also starts from `check`, so no timing run is reachable from it. A change to the gate's step list updates those literals on purpose. |
| 8 (lanes verify with it) | The work orders and the integration review. Nothing machine-checks which command a lane ran. |
| 9, 10, 11, 12 | The integration review only. Nothing machine-checks the level of a test, its locators or the journey list. |
| 13, 14, 15 | The integration review only. Nothing machine-checks a time or a count; the numbers are measured by the commands rule 13 names. |
