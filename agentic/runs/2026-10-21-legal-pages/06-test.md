REPORT 2026-10-21-legal-pages/06
status:      DONE
verdict:     NONE

changed:
  - tests/unit/product-jsonld.test.ts — product() fixture gains demoOnly: false (clears the tsc error that blocked the gate)
  - tests/unit/owner-config.test.ts — new; getOwnerIdentity with stubbed fake env: trim, per-call read, each required blank names the variable, order, registry null
  - tests/unit/legal-pages.test.ts — new; renders LegalNotice, Privacy, Funding content, SiteFooter and DemoNotice with createTranslator and fake values
  - tests/unit/messages.test.ts — new describe for Footer, DemoNotice, LegalNotice, Privacy, Funding key lists, placeholders, rich tags, no ** marker
  - tests/unit/seams.test.ts — new describe: no isDemo/is_demo in src/app or src/components, OWNER_*/CONTACT_EMAIL only in owner.ts, getOwnerIdentity called only by the two pages
  - tests/integration/demo-only.test.ts — new; demoOnly on product and category reads, hidden, in-review and unapproved offers never counted either way, page scoping
  - tests/support/page-checks.ts — expectLocalScriptsAndLinks gains { allowHrefs } exact allow list; new expectLegalFooter(page)
  - tests/e2e/legal.spec.ts — new; footer on six pages, funding page, legal pages branching on host .env, demo notice present and absent cases
  - tests/e2e/product.spec.ts — description check skips the new role=note paragraph (it was main p first, now the notice)

verification:
  command:   npm run gate
  result:    PASS
  detail:    exit 0; vitest 49 files 858 tests passed, 0 skipped; playwright 88 passed, 4 skipped (legal.spec configured-identity tests, host .env owner values blank)

contract_notes:
  - tests/e2e/product.spec.ts:55 asserted the first main p was the description; the DemoNotice is now first in main, so the selector became main p:not([role="note"]). Any later e2e on the first p of a demo page lags the same way.
  - The 4 e2e skips are the configured-identity branch; this host .env has the OWNER_* keys blank, so the 500 branch ran in the gate and the 200 branch only ran in the manual check in handoff.
  - CLAUDE.md § Commands and docs/design/system.md lag as the design and frontend reports already say; no test depends on them.

pack_corrections:
  - testing.md — § Shared scaffolding and gotchas lacks the S9.3 helpers; add: "`expectLocalScriptsAndLinks(page, { allowHrefs })` lets exact hrefs through (legal pages pass the mailto: and https://www.aepd.es); `expectLegalFooter(page)` asserts the contentinfo landmark, three exact hrefs and labels, no p or heading. Legal content components render in unit tests with `createTranslator` from `use-intl/core` and the real messages; the owner fake values are in tests/unit/owner-config.test.ts and legal-pages.test.ts."
  - testing.md — § Running tests lacks the legal e2e rule; add: "legal.spec.ts branches on the host .env: all four required OWNER_* values non-blank means 200 and values asserted as booleans (never printed), otherwise 500 and no brace in the visible text. To exercise the 200 branch without touching .env, export fake OWNER_* in the shell, run docker compose up -d app, run playwright with the same exports, then unset and run docker compose up -d app again."
  - testing.md — § What must always be covered: add "Demo notice: any e2e that reads the first paragraph of main on a demo product or category page must skip p[role=note]."

handoff:
  - Fake identity used in unit tests: Titular de Prueba S.L., B00000000, Calle Falsa 123 28000 Madrid, contacto@example.test, Registro de prueba tomo 1 folio 1.
  - New shared helpers: expectLegalFooter and the allowHrefs option, both in tests/support/page-checks.ts; page-checks.ts now imports messages/es-ES.json.
  - Manual check done: with fake OWNER_* exported in the shell and docker compose up -d app, tests/e2e/legal.spec.ts passed 22 of 22 with the registry set and again with it blank; the stack was then recreated from .env.
  - Integration helper use: productWith in demo-only.test.ts is local to that file (insertFeed isDemo plus insertOffer flags); no shared helper was added.
  - The e2e needs the host .env and the container env to agree; after changing OWNER_* in .env run docker compose up -d before the gate.

skill_calls:
  - engineering:testing-strategy — not called, the design test plan and the nearest specs already fixed the cases
  - mattpocock-skills:tdd — not called, tests follow finished production code

risks:
  - The gate's own run covers only the 500 branch of /aviso-legal and /privacidad on this host; the 200 branch (values, registry on and off, mailto and AEPD allow list) passed only in the manual shell-env run.
  - On the 500 branch the visible-text brace check passes, but I did not confirm what Next renders for the error page body in the Compose production build beyond that check.
  - legal.spec asserts owner values from process.env as booleans so a failure does not print them; a Playwright trace or error-context file could still hold the page text, and test-results/ is git-ignored only if already so.
  - Category demoOnly page scoping is pinned by an integration test (page 1 true, page 2 false); if the owner wants whole-category scope, that test must change with the backend.
  - The e2e demo-notice cases assume every e2e offer is a demo offer (pack says so); the real-offer-hides-notice case is covered only in integration, not on the page.
  - Footer min-height and 404 footer placement are not asserted in a browser layout (no pixel checks), only presence and structure.
