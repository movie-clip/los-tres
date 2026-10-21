REPORT 2026-10-21-legal-pages/05
status:      PARTIAL
verdict:     NONE

changed:
  - messages/es-ES.json — adds Footer, DemoNotice, LegalNotice, Privacy, Funding; owner text word for word, rich tags b/email/aepd and placeholders only
  - src/app/layout.tsx — renders SiteFooter after children with three links from Footer messages
  - src/app/globals.css — body becomes a min-height flex column and body > main takes the slack (footer at the bottom of short pages)
  - src/app/(public)/aviso-legal/page.tsx — force-dynamic page; the only reader of getOwnerIdentity() with privacidad; metaTitle only
  - src/app/(public)/aviso-legal/content.tsx — LegalNoticeContent({ t, siteName, owner }); Datos registrales li only when registry is not null
  - src/app/(public)/privacidad/page.tsx — same shape as aviso-legal
  - src/app/(public)/privacidad/content.tsx — PrivacyContent({ t, siteName, owner }); nine h2s, bold lead-ins, email and aepd links
  - src/app/(public)/como-nos-financiamos/page.tsx — force-dynamic page, no owner identity
  - src/app/(public)/como-nos-financiamos/content.tsx — FundingContent({ t, siteName })
  - src/app/(public)/producto/[slug]/page.tsx — DemoNotice first in main when product.demoOnly
  - src/app/(public)/categoria/[slug]/page.tsx — DemoNotice first in main when category.demoOnly (populated branch only)
  - src/components/SiteFooter.tsx — new; props { links: { href, label }[] }; footer > ul > li > plain a
  - src/components/SiteFooter.module.css — new; edge-to-edge border-top, header-aligned column, 44px wrapping links
  - src/components/DemoNotice.tsx — new; props { text }; p role="note"
  - src/components/DemoNotice.module.css — new; outlined box with 0.25rem link-colour left rule; colour override beats .page p
  - src/components/LegalText.tsx — new; 42rem column, LegalTitle/Heading/Paragraph/List/Item, LegalTranslator type, legalRichTags(contactEmail?)
  - src/components/LegalText.module.css — new; all rules under .column so they beat .page p; links underlined at rest

verification:
  command:   npm run lint && npm run typecheck && npm run test:unit
  result:    FAIL
  detail:    lint clean; test:unit 24 files 510 tests passed; typecheck fails only on tests/unit/product-jsonld.test.ts(13,77) TS2322 demoOnly (06 owns); tsc -p tsconfig.cli.json clean when run alone

contract_notes:
  - tests/unit/product-jsonld.test.ts product() fixture lacks demoOnly: false; it is the single remaining tsc error and blocks npm run typecheck and the gate until 06 fixes it.
  - messages.test.ts needs key lists for Footer, DemoNotice, LegalNotice, Privacy, Funding as in 03-design § Contract: messages; no message contains ** and tagged messages must go through t.rich.
  - Content components take a LegalTranslator (src/components/LegalText.tsx); createTranslator from use-intl/core with the real messages satisfies it, verified by a scratch render.
  - tests/support/page-checks.ts expectLocalScriptsAndLinks still needs the allowHrefs option for mailto: and https://www.aepd.es on legal pages; footer anchors are same-origin paths so it passes for them.
  - docs/design/system.md lags: Footer, Demo notice and Legal text rows are in 02-ux § System additions; add at close-out.

pack_corrections:
  - frontend.md — § Layout, listing components line: append "`SiteFooter` (root layout, after children), `DemoNotice` (`p role=note`, first child of main), `LegalText` (42rem column plus `LegalTitle`/`LegalHeading`/`LegalParagraph`/`LegalList`/`LegalItem` and `legalRichTags`) in `src/components`; legal page bodies live in a sibling `content.tsx` taking `{ t, siteName, owner }`."
  - frontend.md — § Layout: append "`body` is a flex column with `body > main { flex: 1 0 auto; width: 100% }` in globals.css so the footer sits at the bottom of short pages; `.page` centres with auto margins, which stops a flex item stretching, so any new full-width flex child of body needs an explicit width."
  - frontend.md — § Next.js and i18n: append "Messages with rich tags (`<b>`, `<email>`, `<aepd>`) are rendered with `t.rich` and tag functions from `legalRichTags`; owner values enter as ICU values and are escaped. The owner's identity is read only in the `page.tsx` of aviso-legal and privacidad via `getOwnerIdentity()`."
  - frontend.md — § Layout: append "A heredoc containing an apostrophe in a comment fails the whole Bash command and writes nothing; use Write for files with prose comments."

handoff:
  - Routes: /aviso-legal, /privacidad, /como-nos-financiamos; footer hrefs are these literals in this order with labels Aviso legal, Privacidad, Cómo nos financiamos.
  - Test 06: render LegalNoticeContent, PrivacyContent, FundingContent with createTranslator and the real messages; registry null gives four li, a string gives five; mailto href equals the email; aepd href https://www.aepd.es with parentheses outside the a.
  - Test 06: SiteFooter({ links }) renders footer > ul > li > a with no p; DemoNotice({ text }) renders p role="note".
  - Test 06: selectors for e2e are roles and text (footer landmark, role=note); no data-testid was added on the new components.
  - Test 06: product and category pages render DemoNotice only from page.demoOnly; the empty-category branch never renders it.
  - Test 06: aviso-legal and privacidad call getOwnerIdentity() in page.tsx, so a blank required value gives a 500 from the thrown Error naming the variable.
  - UX-REVIEW: footer on 404 relies on body > main; not-found.tsx main.page gets the slack, so the footer should sit at the viewport bottom.

skill_calls:
  - none

risks:
  - Typecheck cannot exit 0 until 06 adds demoOnly to the product-jsonld fixture; hence PARTIAL, not a defect in this lane.
  - globals.css gained a body > main rule (width 100%, flex 1 0 auto) beyond a pure body change; needed because .page auto margins stop a flex item stretching. Inside the fence reading of reset/body, but flagged.
  - Footer is rendered by the root layout, so a future admin area also gets it; the UX spec left this open.
  - Footer on the 404 and the min-height behaviour were not checked in a browser; only lint, tsc, unit tests and a scratch render of the three content components (scratch files removed).
  - DemoNotice colour override uses :global(.page) .notice (0,2,0) against .page p (0,1,1); it assumes the notice is always inside a .page main, true on both pages.
  - Privacy copy says Umami runs; no Umami script is wired (known 03-design risk), not changed here.
