REPORT 2026-10-21-legal-pages/09
status:      DONE
verdict:     NONE

changed:
  - CLAUDE.md — § Commands: paragraph on filling OWNER_NAME, OWNER_NIF, OWNER_ADDRESS, CONTACT_EMAIL (OWNER_REGISTRY optional) after env:init, else /aviso-legal and /privacidad return 500; demo-steps lead-in mentions notice and footer
  - docs/design/system.md — § Components: Footer, Demo notice and Legal text rows added
  - agentic/capabilities/architecture.md — § The seams: Owner identity and Demo flag bullets (3 and 7 merged)
  - agentic/capabilities/backend.md — § Layout getOwnerIdentity; § Guardrails (1) demoOnly; § Guardrails (5) compose ${NAME:-} rule
  - agentic/capabilities/frontend.md — § Layout: new components, flex-column body rule, heredoc line reworded in place; § Next.js and i18n: rich tags and owner read site
  - agentic/capabilities/testing.md — § Running tests: legal.spec branch rule; § What must always be covered: demo notice; § Shared scaffolding: S9.3 helpers
  - agentic/capabilities/ux.md — § Running the app: fake-env recipe; § Producing the states: three new rows

verification:
  command:   NONE
  result:    NOT_RUN
  detail:    order verification NONE; premises spot-checked by grep (owner.ts consumers, isDemo confined to src/server, compose and .env.example OWNER keys)

contract_notes:
  - none

pack_corrections:
  - none

handoff:
  - Human: docs/product/mvp.md noindex/sitemap clause for demo products is still unimplemented; left untouched per order.
  - Human: SHOULD_FIX carried from ux-review stays open: blank owner values give Next's English 500 page with no footer; shop buttons use the browser default focus ring.
  - Commit the docs, CLAUDE.md and pack edits with the run; screens/ under the run dir stays out of the commit.

skill_calls:
  - none

risks:
  - Duplicates applied once: the 03 and 07 owner-identity and demo-flag entries became two architecture.md bullets; the 04 Layout and 05 Next.js entries are pointers to the same fact in their own packs, not copies.
  - The frontend heredoc-apostrophe entry replaced the existing Layout sentence instead of adding a second; testing.md keeps its own older heredoc lines, not in scope of the corrections.
  - docs/product/mvp.md § Legal pages and demo paragraph were checked and are accurate for S9.3; no other docs/** statement went stale.
  - The footer wireframe in the ux spec predicted two rows at 390 while the build shows one; system.md copies the anatomy row, which says "wrapping on a phone" and stays true.
