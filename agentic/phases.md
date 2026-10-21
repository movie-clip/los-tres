<!-- Profile extension: ORCHESTRATOR only, read at intake.
     `check_report.py` reads the `verify` rows here; see `## Phases` below. -->

# Project phases: `los-tres`

The phase→lane binding for this project. Read this at intake, alongside
`project.md`. No specialist lane needs it.

## Contents

- **Phases** — the binding table: which lane fills each phase, in what order,
  and the clause that decides whether it fires. Copied into the run ledger.
- **When the brief is the specification** — when `story` fires here.
- **What the gates run** — the command each `verify` row owes.
- **Tracker** — the GitHub board and repo the orchestrator keeps in step with
  each run (`protocol/orchestrator.md` § 8).

## Phases

`protocol/orchestrator.md` § 2 defines the phases and § 3 the loop that walks
them. This table is the binding: which lane fills each phase **here**, in what
order, and the clause that decides whether it fires at all. The orchestrator
copies it into the run ledger at intake and records a verdict beside every row.

| Phase | # | Lane | Fires when | Human stop |
|---|---|---|---|---|
| ground-truth | 1 | recon | the request names existing code or rests on an unverified claim about current behaviour | — |
| framing | 1 | product | the request adds a user-facing surface, changes what one is *for*, or `docs/product/mvp.md` does not exist yet | **yes** — the brief is relayed and the verdict is the human's |
| specification | 1 | story | framing produced scope no approved brief covers, **and** the slice crosses more than one lane's contract or changes a data model or API response that shipped code depends on | **yes** — the one hard stop |
| design | 1 | ux | the request adds or changes a public or admin screen, a user flow, or user-facing copy | **yes**, when the spec says `direction: new` or `direction: changed`: the spec is relayed and the verdict is the human's. `direction: unchanged` passes without a stop |
| design | 2 | design | the change crosses the frontend/backend contract (a new or changed API response, a schema change), or more than one build lane touches it, or the request needs a choice no recorded decision covers (`project.md` § Building before the stack exists) | — |
| build | 1..n | backend, frontend, test, docs | anything that edits repo code, tests or `docs/**` — and only once the stack it needs is recorded | **yes** — the human's go on the build plan, before the branch is created |
| verify | 1 | integration | any build lane was dispatched | — |
| verify | 2 | ux-review | `ux` was satisfied, or a build lane changed what a public or admin screen renders | — |
| verify | 3 | review | the run carries a story whose acceptance criteria someone must accept | — |
| close | 1 | docs | always — `docs/**` against what shipped, and `pack-corrections.md` against `capabilities/` **when a lane emitted one** | — |

`quant-audit` has no row. `project.md` § "Why `quant` is not bound" is the
reason.

### When the brief is the specification

The MVP will produce slices that cross lanes: feed import and matching, the
catalogue and product page, the click redirect, admin feed and matching
screens. A story is warranted on those when no
approved brief already fixes the shape. One endpoint, one component or one copy
change does not get one: the delivery brief is the specification. Record the
row as `not triggered (the delivery brief in <nn> is the specification)`, and
`review` then does not fire either.

### What the gates run

`integration` runs the lint and test commands `CLAUDE.md` § Commands lists. If
it lists none, that is a `BLOCKING` finding on any build, not a pass by default.
`architecture.md` carries the rule. `ux-review` screenshots the running app at
phone and desktop widths and checks the UX spec (`ux.md`); it runs after
`integration` passes, because a screen that fails the gate is not worth
looking at. `review` verifies the story's acceptance criteria one by one.

### What `ux` feeds

The UX spec goes to `design` (the tech lead plans the contract from its data
needs) and to the `frontend` build order, both as an `inputs` path. When the
spec says `direction: new` or `direction: changed` and `decisions.md` records
the human's approval, the spec and `decisions.md` also go to the close-out
`docs` order as `inputs`, so it can write `docs/design/system.md`. A `FAIL`
from `ux-review` routes its findings to `frontend`, like any gate's.

## Tracker

| Key | Value |
|---|---|
| server | `github` — the `.mcp.json` key |
| repo | `movie-clip/los-tres` |
| board | Project 3, owned by user `movie-clip` |
| statuses | new `Backlog` · building `In progress` · reviewing `In review` · human only `Ready`, `Done` |
| labels | epic `type:epic` · story `type:story` · ticket `type:ticket`; a single-lane change gets one unlabelled issue |
| branch | `<issue>-<slug>` from `main` |

The repo and the board are public.
