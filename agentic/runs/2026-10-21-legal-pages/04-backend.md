REPORT 2026-10-21-legal-pages/04
status:      PARTIAL
verdict:     NONE

changed:
  - src/config/owner.ts — new; getOwnerIdentity() and OwnerIdentity per contract (four required via readRequiredEnv, registry via readOptionalEnv ?? null)
  - src/server/catalogue/product-page.ts — PublicProductPage.demoOnly; select adds feeds.isDemo; demoOnly = rows.every(isDemo); not copied into PublicOffer
  - src/server/catalogue/category-page.ts — PublicCategoryPage.demoOnly; grouped select adds bool_and(feeds.isDemo) as allDemo; cards mapped explicitly so allDemo is stripped
  - compose.yaml — app.environment forwards OWNER_NAME, OWNER_NIF, OWNER_ADDRESS, OWNER_REGISTRY, CONTACT_EMAIL as ${NAME:-}
  - .env.example — five empty keys plus one comment line
  - tests/integration/product-page.test.ts — whole-contract toEqual gains demoOnly: false
  - tests/integration/category-page.test.ts — two whole-contract toEqual assertions (shape, empty category) gain demoOnly: false

verification:
  command:   npm run lint && npm run typecheck && npm test
  result:    FAIL
  detail:    lint clean; npm test 46 files 770 tests passed; typecheck fails: tests/unit/product-jsonld.test.ts(13,77) TS2322, product() fixture lacks demoOnly (outside this order's fence)

contract_notes:
  - PublicProductPage and PublicCategoryPage gain required demoOnly: boolean; the frontend (product and category pages) and every hand-built PublicProductPage fixture lag.
  - tests/unit/product-jsonld.test.ts product() fixture (line 13) returns PublicProductPage without demoOnly, so tsc fails; add demoOnly: false to its literal.
  - src/config/owner.ts is the new only reader of OWNER_* and CONTACT_EMAIL; the frontend legal pages (05) consume getOwnerIdentity(): OwnerIdentity.
  - architecture.md and CLAUDE.md § Commands lag: four required OWNER_* values must be filled in .env or /aviso-legal and /privacidad return 500.
  - Any test asserting .env.example or compose.yaml key lists lags only if it enumerates all keys; none failed in npm test.

pack_corrections:
  - backend.md — § Layout: after "src/config (env readers, `getSiteName`, `isDemoSeedEnabled`" add "`getOwnerIdentity` in owner.ts: the only reader of OWNER_* and CONTACT_EMAIL; the four required throw 'NAME is not set', OWNER_REGISTRY is optional".
  - backend.md — § Guardrails (1): add "`demoOnly` on the product and category page data is computed only in src/server/catalogue from feeds.is_demo over visible offers; no file under src/app or src/components names isDemo."
  - backend.md — § Guardrails (5): add "compose.yaml forwards optional or legal-identity values as ${NAME:-} and never :?, so migrate, import-feeds and the e2e setup keep working with them blank."

handoff:
  - Frontend 05: read product.demoOnly and category.demoOnly, render DemoNotice first in main when true; never read isDemo.
  - Frontend 05: call getOwnerIdentity() only in the aviso-legal and privacidad page.tsx; it throws Error("<NAME> is not set") naming the first blank variable, in order OWNER_NAME, OWNER_NIF, OWNER_ADDRESS, CONTACT_EMAIL.
  - Test 06: fix tests/unit/product-jsonld.test.ts line 13 fixture (add demoOnly: false) to clear tsc; this blocks npm run typecheck for the whole branch.
  - Test 06 integration cases to add: all-demo true; one real visible offer false; demo visible plus real hidden or unapproved true; real visible plus demo hidden false; empty category false; mixed page scoped to displayed cards.
  - Test 06 unit cases: owner config trims, each required blank throws exactly "<NAME> is not set", registry blank gives null, read per call.
  - tests/support/catalogue.ts insertFeed already takes isDemo (default false), so the existing helpers need no change.

skill_calls:
  - none

risks:
  - Verification FAIL is solely the tests/unit/product-jsonld.test.ts fixture; the order fence allows only tests/integration, so I stopped rather than edit it. The one-line fix belongs to whoever owns that file (test 06 or an orchestrator fence extension).
  - Category demoOnly is scoped to the displayed page cards (design default); a mixed category can flag page 2 but not page 1.
  - bool_and over feeds.is_demo assumes the column is NOT NULL; a nullable column would make a null-only group return null, which every() treats as false (safe direction).
  - Fresh clone: env:init leaves the four required keys empty, so the two legal pages 500 until filled (known design risk, not a backend defect).
