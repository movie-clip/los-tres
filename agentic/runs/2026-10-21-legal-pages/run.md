# RUN 2026-10-21-legal-pages
request:      Run S9.3 (#52), Legal and affiliate disclosure pages, including T9.3.3 demo notice. O4 (#204) text is handed over: the owner's final Spanish text is in C:\projects\investments\los-tres-private\legal-es.md. It is outside the repo on purpose - copy its texts into messages/es-ES.json word for word, and never copy or commit that file itself. The text uses {siteName} plus five identity placeholders: {ownerName}, {ownerNif}, {ownerAddress}, {ownerRegistry}, {contactEmail}. The repo is public, so these come from environment variables OWNER_NAME, OWNER_NIF, OWNER_ADDRESS, OWNER_REGISTRY, CONTACT_EMAIL, read on the server the way SITE_NAME is, and added to .env.example as empty keys. No real identity value may appear anywhere in src/, messages/, tests or docs. When OWNER_REGISTRY is empty, the "Datos registrales" line does not render. Tests use fake values. Pages: Aviso legal, Política de privacidad, Cómo nos financiamos - linked from the footer of every page with the labels in the file. The demo notice shows on pages that list only demo offers. No cookie banner (decision 0009). Payee entity is not settled yet; it changes only the env values, not the build.
agentic_root: C:\projects\investments\.agentic
project:      los-tres
project_dir:  C:\projects\investments\los-tres\agentic
story:        NONE
status:       CLOSED
phase:        close
plan:         v2
budget:       9 — recon 1 + ux 1 + design 1 + build 3 (backend, frontend, test) + integration 1 + ux-review 1 + close docs 1
spent:        9
next:         none — CLOSED
gates:        review skipped (no story file; issue 52 says Story file: no) · integration PASS · ux-review PASS

## Phases
| phase | lane | fires when | state |
|---|---|---|---|
| ground-truth | recon | the request names existing code or rests on an unverified claim about current behaviour | satisfied — 01 |
| framing | product | adds a user-facing surface / mvp.md missing | not triggered (surface already framed and ruled: issue #52, D-1/D-3 of run 2026-10-17-mvp-backlog-revision, docs/product/mvp.md) |
| specification | story | new scope crossing contracts or data model | not triggered (framing produced no new scope; #52 says Story file: no) |
| design | ux | adds or changes a public screen or copy | satisfied — 02 (direction: unchanged, no stop) |
| design | design | crosses contract, or more than one build lane | satisfied — 03 |
| build | frontend, test | edits repo | satisfied — 04, 05, 06 |
| verify | integration | any build lane dispatched | satisfied — 07 |
| verify | ux-review | ux satisfied | satisfied — 08 |
| verify | review | run carries a story | not triggered (no story file) |
| close | docs | always | satisfied — 09 |

## Artifacts
| # | lane | mode | agent | model | artifact | status | verdict |
|---|------|------|-------|-------|----------|--------|---------|
| 01 | recon | — | scout | sonnet | 01-recon.md | DONE | — |
| 02 | ux | UX | designer | sonnet | 02-ux.md | DONE | — |
| 03 | design | DESIGN | tech-lead | opus | 03-design.md | DONE | — |
| 04 | backend | — | backend-engineer | sonnet | 04-backend.md | PARTIAL | — |
| 05 | frontend | — | frontend-engineer | sonnet | 05-frontend.md | PARTIAL | — |
| 06 | test | — | test-engineer | sonnet | 06-test.md | DONE | — |
| 07 | integration | INTEGRATION | tech-lead | opus | 07-integration.md | DONE | PASS |
| 08 | ux-review | UX-REVIEW | designer | sonnet | 08-ux-review.md | DONE | PASS |
| 09 | docs | — | docs-engineer | sonnet | 09-docs.md | DONE | — |

## Open
| kind | from | ref | one-line | state |
|---|---|---|---|---|
| contract_note | 01-recon | 01-recon.md#cn6 | mvp.md demo noindex/sitemap clause unimplemented, outside S9.3 | CARRIED |
| should_fix | 08-ux-review | 08-ux-review.md#sf1 | blank owner values give Next's English 500 page without header/footer | CARRIED |
| should_fix | 08-ux-review | 08-ux-review.md#sf3 | shop buttons use browser default focus ring (pre-existing) | CARRIED |

## Closed
| kind | from | absorbed by | one-line |
|---|---|---|---|
| partial | 04-backend | 06-test | fixture lacks demoOnly; typecheck fails; route to 06 test |
| partial | 05-frontend | 06-test | typecheck blocked by product-jsonld fixture (same as 04); 06 owns |
| contract_note | 01-recon | 04-backend | public page contracts lack a demo flag |
| contract_note | 01-recon | 04-backend | compose.yaml must forward OWNER_*/CONTACT_EMAIL |
| contract_note | 01-recon | 06-test | messages.test.ts key lists need the new namespace |
| contract_note | 01-recon | 05-frontend | legal routes must live under src/app/(public)/ |
| contract_note | 02-ux | 06-test | page-checks.ts same-origin link helper fails on mailto/aepd links |
| should_fix | 08-ux-review | dismissed — spec wording only, build correct | spec predicted 2-row footer and 4-line notice at 390; build is right |
| contract_note | 01-recon | 09-docs | docs/design/system.md lacks Footer and Notice rows |

## Rounds
| finding | lane | round | of | caused by |
|---|---|---|---|---|

## Replans
| plan | because | change |
|---|---|---|
| v2 | 03-design put src/config and src/server changes in a backend lane | build 2 -> 3 lanes; budget 8 -> 9 |
