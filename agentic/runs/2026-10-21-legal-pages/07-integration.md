REPORT 2026-10-21-legal-pages/07
status:      DONE
verdict:     PASS

changed:
  - none

verification:
  command:   npm run gate
  result:    PASS
  detail:    exit 0; lint and both tsc clean; vitest 49 files 858 passed; playwright 88 passed, 4 skipped (identity-configured branch, host .env OWNER_* blank). Copy anchor: legal-es.md, 0 mismatches by script.

contract_notes:
  - none

pack_corrections:
  - architecture.md — § The seams the product forces: add "Owner identity (`src/config/owner.ts`): the only reader of OWNER_* and CONTACT_EMAIL; only the aviso-legal and privacidad page.tsx call it."
  - architecture.md — § The seams: add "Demo flag: `demoOnly` is computed only in src/server/catalogue from feeds.isDemo inside the visibleOfferWhere() query; no file under src/app or src/components names isDemo (seams.test.ts enforces)."

handoff:
  - No change requests; no files under cr/. Integration gate passes; ux-review and close docs may proceed.
  - Close docs: CLAUDE.md § Commands must say the four required OWNER_* values go in .env, else /aviso-legal and /privacidad return 500.
  - Close docs: docs/design/system.md needs Footer, Demo notice and Legal text rows (02-ux § System additions), as 05 noted.

skill_calls:
  - none

risks:
  - The gate on this host ran only the 500 branch of /aviso-legal and /privacidad; the 200 branch passed only in 06's manual shell-env run. Unit render tests cover the same content with fake values.
  - Identity-leak search used patterns (emails, NIF shapes) over the diff, because host .env OWNER_* are blank; only the fake values B00000000 and contacto@example.test appear.
  - Privacy copy states Umami runs, but no Umami script is wired yet; producer/owner finding carried from 03, not a build defect.
  - Category demoOnly is scoped to the displayed page of cards (design default, pinned by an integration test); whole-category scope would be an owner call.

## Orchestrator brief
- Verdict: PASS. Gate exit 0 (858 vitest, 88 e2e passed, 4 skipped by design). No CRs.
- Contract: owner.ts, demoOnly on both page types, five namespaces with b/email/aepd tags, three routes, compose `${NAME:-}` and .env.example all match 03-design field by field.
- Guardrail 1: demoOnly computed in the existing visibleOfferWhere() queries; integration tests prove hidden/unapproved offers never count.
- Guardrail 5: no real identity value in the diff; legal-es.md not tracked; messages hold placeholders only.
- Copy: every message (metaTitle excluded) matches legal-es.md verbatim after removing tags, by script.
- Next: ux-review, then close docs (CLAUDE.md OWNER_* note, design system rows). See § Review notes.

## Review notes

- **Contract alignment.** `OwnerIdentity` has the planned five fields; the required four throw in the planned order via `readRequiredEnv`; `registry` is `string | null`. `PublicProductPage.demoOnly` and `PublicCategoryPage.demoOnly` are required booleans; `PublicOffer` and `CategoryProductCard` stay unchanged (the cards are mapped explicitly, so `allDemo` is stripped). The pages read only `demoOnly`.
- **Design followed.** Routes, `force-dynamic`, `content.tsx` split, `SiteFooter`/`DemoNotice`/`LegalText` props and placement all match. The extra `body > main` rule in globals.css was declared in 05's risks, not hidden.
- **Reuse.** `readRequiredEnv`/`readOptionalEnv`, the `site.ts` per-call pattern, the existing feeds join and grouped query. There is no second visibility filter and no new query.
- **Tests test the contract.** The tests check the visible-offer semantics of `demoOnly`, the error text naming the variable, registry omission, the exact footer hrefs, and the seam scans. They do not test implementation details.
- **Skill-call fidelity.** No pack names a skill condition for these lanes. 04 and 05 say `none` and cite no tradeoff that would call for a skill. 06 lists two skills it did not call, with reasons. No contradiction.
