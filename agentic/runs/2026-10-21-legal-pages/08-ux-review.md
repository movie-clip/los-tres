REPORT 2026-10-21-legal-pages/08
status:      DONE
verdict:     PASS

changed:
  - none

verification:
  command:   docker compose up -d app (fake OWNER_* in shell) then playwright screenshots, computed-style and Tab scripts at 390, 1280 and 320 wide against http://127.0.0.1:3010
  result:    PASS
  detail:    30 of 31 checks SATISFIED from screenshots or computed styles, 1 not checked (26, not producible); 0 GAP, 0 DRIFTED that blocks; anchor is the rendered page, Tab script run (focus is a screenshot check)

contract_notes:
  - none

pack_corrections:
  - ux.md — § Running the app and taking screenshots: add "To see the configured legal pages export fake OWNER_NAME, OWNER_NIF, OWNER_ADDRESS, CONTACT_EMAIL (and OWNER_REGISTRY, empty or set) in the shell, run docker compose up -d app, then unset and run it again; the host .env OWNER_* are blank so /aviso-legal and /privacidad return 500 until then."
  - ux.md — § Producing the states: add a row "legal pages, identity set" (/aviso-legal, /privacidad, /como-nos-financiamos, needs the fake-env recreate).
  - ux.md — § Producing the states: add a row "legal page, identity blank" (/aviso-legal returns 500 with Next's default English error page).
  - ux.md — § Producing the states: add a row "demo notice" (shown on the demo product, /categoria/filtros, ?pagina=2, escobillas; absent on home, empty category, 404, legal pages).

handoff:
  - SHOULD_FIX: with the owner values blank, /aviso-legal and /privacidad return 500 and render Next's default English "This page couldn't load / Reload" page with no header or footer, see screens/blank-aviso500-phone.png; a Spanish error page with the footer would be kinder to a reviewer who opens it.
  - SHOULD_FIX: the footer fits on one row at 390 (links at x=24, 114, 202), while 02-ux § Footer wireframe and check 6 predicted two rows; wrapping works (two rows at 320, screens/cfg-aviso-320.png), so the spec wireframe was wrong, not the build.
  - SHOULD_FIX: the shop buttons on the product page show the browser default focus ring (outline 1px auto, near-black) while header and footer links show the 3 px blue ring; pre-existing and outside this change, see tab-product-link1.png.
  - SHOULD_FIX: the phone notice is three lines, not "about four" as 02-ux said; harmless, spec wording only.
  - The stack was recreated without the fake values (plain docker compose up -d app); the app container now holds blank OWNER_*, /api/health is 200 and /aviso-legal is 500 again, as with the host .env.
  - Close docs: the Footer, Demo notice and Legal text rows in 02-ux § System additions still need to reach docs/design/system.md.
  - Screenshots in run_dir/screens/ show only the fake values (Titular de Prueba S.L., B00000000, Calle Falsa 123, contacto@example.test, fake registry); the order says images are not committed, so leave screens/ out of the commit.

skill_calls:
  - none

risks:
  - The pack names no skill for UX-REVIEW mode, so none was called.
  - Check 23 and 14 text: I could not open legal-es.md (denied, it is outside the repo and not in my inputs), so the demo sentence was compared with the 02-ux wireframe, which quotes it, and 07-integration reports a script match against legal-es.md; that is a consistency check, not an independent one.
  - Check 26 (real offer hides the notice) is not producible on the dev stack; only 06's integration test covers it, so no screenshot supports it.
  - Mixed pages (demo and real offers) show no notice and an unlabelled demo card, as 02-ux risks already says; not a build defect.
  - The configured pages were seen with a long fake address, email and registry (screens/cfg-*) and again with short values and no registry (screens/noreg-aviso-*); the real owner's values were never seen.
  - Visited-link styling and hover underline were not exercised; hover and visited were not screenshotted.

## Orchestrator brief
- Verdict: PASS. No blocking finding; no change requests needed.
- 30 of 31 checks SATISFIED with a screenshot or computed-style read; check 26 not checked (not producible). 0 GAP, 0 DRIFTED.
- Footer on home, product, category, empty category, 404 and the three legal pages at 390 and 1280; 44 px links, 1 px edge-to-edge border, x=24/152 aligned with the header name, 404 footer flush with the 800 px viewport.
- Legal pages: identity set (long and short values), registry set (5 bullets) and blank (4 bullets, no "Datos registrales" in the HTML), 672 px column at x=152, h1 32 px, bold lead-ins, underlined links with the parentheses outside.
- Demo notice: present on the product page and category pages 1 and 2 and the one-card category, above the h1, 16 px near-black on white, 4 px blue rule; absent on home, empty category, 404, legal pages.
- Focus: Tab script on three pages, 3 px blue ring with 2 px offset on header, in-text and footer links; order header, text links, footer.
- No cookie set (0 cookies, no Set-Cookie), no banner; document titles are "<label> | Los Tres".
- Four SHOULD_FIX in handoff (500 page is Next's English default, footer is one row at 390, shop-button focus ring, notice line count). Stack restored to the .env state.
- Sections below: Check results (31 rows with screenshot paths), States.

## Check results

Screens are in C:\projects\investments\los-tres\agentic\runs\2026-10-21-legal-pages\screens\. Prefix `cfg-` is the fake identity with long values and the registry set; `noreg-` is short values with the registry blank; `tab-` are keyboard-focus shots. "Computed" means a getComputedStyle or getBoundingClientRect read in the same Playwright session as the screenshot.

| # | Result | Evidence |
|---|---|---|
| 1 | SATISFIED | cfg-home-phone.png, cfg-product-phone.png, cfg-cat-desktop.png, cfg-catempty-phone.png, cfg-404-desktop.png each end with a footer of three blue links; same for the desktop shots. |
| 2 | SATISFIED | cfg-aviso-phone.png, cfg-priv-desktop.png, cfg-fin-desktop.png each end with the footer. |
| 3 | SATISFIED | Footer text in every shot reads "Aviso legal", "Privacidad", "Cómo nos financiamos" in that order; the DOM read gives the same labels. |
| 4 | SATISFIED | Computed: footer x=0 width 1280, border-top 1px rgb(226,226,226); first link x=152 at 1280 and x=24 at 390, header name x=152 and 24; see cfg-aviso-desktop.png. |
| 5 | SATISFIED | cfg-404-desktop.png: the footer reaches the bottom edge, no white below; computed footer bottom 800 on an 800 px page. |
| 6 | SATISFIED | cfg-aviso-phone.png: nothing clipped, scrollWidth 390; computed link height 44. The shot shows one row, not the two the check predicted; wrap proven at 320 in cfg-aviso-320.png (two rows, footer 105 px). Wireframe prediction was wrong, see handoff. |
| 7 | SATISFIED | Computed footer link: 14px, weight 400, rgb(11,92,173), no underline; footer holds 0 p or heading elements; no copyright line in cfg-aviso-desktop.png. |
| 8 | SATISFIED | Fetched all three paths: 200, h1 "Aviso legal", "Política de privacidad", "Cómo se financia Los Tres"; screens cfg-aviso-*, cfg-priv-*, cfg-fin-*. |
| 9 | SATISFIED | Computed h1 32px weight 700 on each page; h2 20px (cfg-priv-desktop.png shows the size step). |
| 10 | SATISFIED | cfg-aviso-desktop.png lists Objeto, Información de precios, Datos de demostración, Propiedad intelectual e industrial, Enlaces a terceros, Legislación aplicable in order; 20px against 16px body and 32px h1. |
| 11 | SATISFIED | cfg-priv-desktop.png: nine h2s in the spec order; computed gap h1 to first h2 is 24 px (one h2 top margin), children of main are H1, H2, P. |
| 12 | SATISFIED | cfg-fin-desktop.png: h1, intro, three bullets, no h2 (heading list is the h1 only). |
| 13 | SATISFIED | Computed strong weight 700 against li weight 400 for the three privacy lead-ins; cfg-fin-phone.png shows the three financing lead-ins bold and the rest regular; no `**` in any page text. |
| 14 | SATISFIED | Script over document.body.innerText for `{`, `}` and `**` returned false on all ten pages at both widths. Text match against legal-es.md not independently done, see risks. |
| 15 | SATISFIED | cfg-aviso-desktop.png: Titular, NIF, Domicilio, Correo electrónico each with a value; "Los Tres" fills the site name in Objeto and the financing h1. |
| 16 | SATISFIED | noreg-aviso-phone.png: four bullets, no registry label; the fetched HTML has 0 occurrences of "Datos registrales". |
| 17 | SATISFIED | cfg-aviso-desktop.png: five bullets, the fifth "Datos registrales: Registro de prueba tomo 1 folio 1 ..." (fake value). |
| 18 | SATISFIED | Computed: main column x=152, width 672; rightmost text edge 823 on the privacy page; cfg-priv-desktop.png shows text ending near x=825 against a 1024 px page column. |
| 19 | SATISFIED | Computed body p colour rgb(26,26,26); the category note "26 productos · Página 1 de 2" in cfg-cat-desktop.png is visibly grey beside it. |
| 20 | SATISFIED | Computed: email links and www.aepd.es are rgb(11,92,173) with underline; the node before www.aepd.es ends " (" and after starts ")." so the parentheses are outside; see cfg-priv-desktop.png. |
| 21 | SATISFIED | cfg-priv-phone.png and cfg-aviso-phone.png: the 55-character email and the long address wrap in the column; scrollWidth equals 390 on both. |
| 22 | SATISFIED | Computed h2 margin-top 24 against paragraph margin-bottom 16 (and 24 px gap read above an h2); visibly more air above the h2s in cfg-aviso-phone.png, though the difference is modest. |
| 23 | SATISFIED | cfg-product-phone.png and cfg-product-desktop.png: outlined white box, blue left rule, sentence "Esta página muestra datos de demostración: los productos, los precios y las tiendas no son reales.", first child of main and before the h1. Wording compared with 02-ux, see risks. |
| 24 | SATISFIED | cfg-cat-desktop.png (page 1) and cfg-cat2-phone.png (page 2) both show the notice above the h1; role=note read on both and on cfg-cat1. |
| 25 | SATISFIED | role=note count is 0 on home, empty category, 404 and the three legal pages (script output for cfg-home, cfg-catempty, cfg-404, cfg-aviso, cfg-priv, cfg-fin). |
| 26 | not checked | A real offer is not producible on the dev stack; only 06's integration test covers it. |
| 27 | SATISFIED | Computed notice: 16px, rgb(26,26,26) on rgb(255,255,255), 1px border rgb(226,226,226), 4px left rule rgb(11,92,173), radius 8px; 0 buttons, svg, img or links inside; no filled panel in cfg-product-desktop.png. |
| 28 | SATISFIED | cfg-product-phone.png: notice wraps to three lines inside the column, h1 and image follow with a visible 24 px gap. Three lines, not four, see handoff. |
| 29 | SATISFIED | Tab script, 1280 wide: /privacidad visits header, email, email, www.aepd.es, then the three footer links, each with outline 3px solid rgb(11,92,173) offset 2px; tab-priv-link3.png and tab-priv-footer3.png show the ring. Same on /aviso-legal and the product page for the new links. |
| 30 | SATISFIED | 0 cookies in the browser context after every page and no Set-Cookie on /aviso-legal; no banner, bar or dialog in any screenshot. |
| 31 | SATISFIED | Read from the rendered page: "Aviso legal | Los Tres", "Privacidad | Los Tres", "Cómo nos financiamos | Los Tres". Not a screenshot check. |

## States

- Footer, any page: seen on home, product, category pages 1 and 2, one-card category, empty category, 404 and the three legal pages, phone and desktop (cfg-* files).
- Footer, short page: cfg-404-desktop.png and cfg-fin-desktop.png sit flush at the bottom of the 800 px viewport.
- Footer, phone: one row at 390, two rows at 320 (cfg-aviso-320.png), no sideways scroll at either.
- Legal page, populated, long values, registry set: cfg-aviso-phone.png, cfg-aviso-desktop.png, cfg-priv-phone.png, cfg-priv-desktop.png, cfg-fin-phone.png, cfg-fin-desktop.png.
- Legal page, registry blank: noreg-aviso-phone.png, noreg-aviso-desktop.png (four bullets).
- Legal page, owner values blank (the host .env state): /aviso-legal returns 500 with Next's default English error page and no footer, blank-aviso500-phone.png and blank-aviso500-desktop.png. The spec left this behaviour to the tech lead (02-ux § States); recorded as SHOULD_FIX, not blocking.
- Demo notice, product and categories: shown (cfg-product-*, cfg-cat-*, cfg-cat2-*, cfg-cat1-*); absent on home, empty category, 404 and legal pages.
- Demo notice, a page with a real offer: not checked.
- /privacidad with owner values blank was not screenshotted (same 500 branch as /aviso-legal by the 07 report).
