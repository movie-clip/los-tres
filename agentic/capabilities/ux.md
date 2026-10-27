# Capability pack: ux — project `los-tres`

For the `designer` lane, in both modes: UX (the spec, before the tech lead's
design pass) and UX-REVIEW (the gate, on the running app). It covers the public
catalogue and the admin area.

The design system is `docs/design/system.md`, approved in the S5.1 and S5.2
runs; its tokens live in `src/app/globals.css`. A UX order that applies it
marks `direction: unchanged`; one that changes it marks `direction: changed`
and writes the whole system in its `Design system` section.

---

## Index

Read this block first. You are not expected to read this file end to end — read
what your order touches. Reading one extra section is cheap; acting on a
convention you never read is not.

**Always read:** **Who the screens are for** · **Where the design lives** · **Guardrails, in design terms** · **Definition of done for this lane**

| Section | Read it when |
|---|---|
| The design skill | your order is a UX order |
| Running the app and taking screenshots | you need to see a screen: UX mode for the existing screens, UX-REVIEW always |
| Producing the states | your order is a UX-REVIEW order |
| Spanish market conventions | your spec or review covers copy, prices or dates |

---

## Who the screens are for

Consumers and talleres (workshops) across Spain who already know what they want
to buy: a part number, an EAN, a filter, a drill. They came to find the cheapest
shop that sells it and leave through a shop link. Every public screen is judged
by how fast a visitor gets from arrival to that click, and by whether they trust
the price they see. `docs/product/mvp.md` is the scope; read it before a UX order.

The admin screens are for the owner and two friends: approving feeds, mapping
categories, working the matching queue. Dense and fast beats pretty there.

## Where the design lives

| Path | What lives there | Owner |
|---|---|---|
| `docs/design/system.md` | the design system: principles, tokens (colour, type, spacing), components and their states, copy voice | `docs-engineer` at close-out, copied from your approved `Design system` section |
| `src/app/globals.css` | the tokens as CSS custom properties, and the reset | `engineer` (frontend), built to `system.md` |
| `src/components/*.module.css` | component styles | `engineer` (frontend) |
| `messages/es-ES.json` | every user-facing string | `engineer` (frontend), from your spec's copy |

You edit no repo file. Read `docs/design/system.md` first on every order; when
it does not exist yet, the system is whatever `globals.css` holds. When the doc
and `globals.css` disagree, report the drift in `risks`; do not fix either.

## The design skill

Call `frontend-design:frontend-design` (Anthropic's official skill) at the start
of a UX order. Use its two passes: a compact token-and-wireframe plan, then a
review of that plan against generic defaults before you write the spec.

Two adaptations for this site:

- **Trust and speed come before distinctiveness.** Spend the skill's "one bold
  element" on the brand and the header, never on the offer list. The offer list
  is read by scanning: shop, price, button, in the same place on every row.
- **The brief wins.** Where the skill and this pack or `mvp.md` disagree, the
  pack and `mvp.md` win.

If the skill is not available in your session, say so in `risks` and work from
this pack.

Do not call any `mattpocock-skills:*` skill from this lane. `prototype` writes
throwaway app code and needs a human flipping variants in the browser, which
makes it a human session tool and not a dispatched lane. `grilling` needs a
human, and `research` needs the `Agent` tool.

## Running the app and taking screenshots

The Compose stack serves the app on `http://127.0.0.1:<APP_PORT>`. `APP_PORT`
is in the repo's `.env`, and is 3010 on the owner's machine. Check it before
starting anything: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<APP_PORT>/api/health`.
If it is not 200, run `npm run stack:up` and then
`docker compose run --rm app import-feeds` for the demo data. Leave the stack
running when you finish.

Take screenshots from the repo root with Playwright's CLI, which the repo
already installs:

```bash
npx playwright screenshot --viewport-size=390,844 --full-page --lang=es-ES <url> <run_dir>/screens/<nn>-<screen>-phone.png
npx playwright screenshot --viewport-size=1280,800 --full-page --lang=es-ES <url> <run_dir>/screens/<nn>-<screen>-desktop.png
```

To see the configured legal pages export fake `OWNER_NAME`, `OWNER_NIF`, `OWNER_ADDRESS`, `CONTACT_EMAIL` (and `OWNER_REGISTRY`, empty or set) in the shell, run `docker compose up -d app`, then unset and run it again; the host `.env` `OWNER_*` are blank so `/aviso-legal` and `/privacidad` return 500 until then.

Phone (390 wide) and desktop (1280 wide) are the two viewports. Open every
image with `Read` before you judge it. A finding names its screenshot file.

The CLI cannot press Tab, so keyboard focus is not visible in a screenshot. A short node script using the repo's `playwright` package can: run it with `createRequire` from the repo `package.json`, press Tab and screenshot; then focus is a screenshot check, not a consistency check. Without that script, check both halves as consistency checks, labelled so:

- **Visibility:** the `:focus-visible` styles in the CSS.
- **Order:** fetch the page (`curl -s <url>`), list the focusable elements
  (`a[href]`, `button`, `input`, `select`, `textarea`, `[tabindex]` not `-1`)
  in document order, and compare that order with the reading order in the
  screenshots. A positive `tabindex` is a finding.

## Producing the states

| State | How to bring it up |
|---|---|
| a product with offers | `/producto/demo-filtro-de-aceite-oc-1234` (demo data, two shops) |
| not found | `/producto/no-existe` |
| home, populated | `/` (four of the five children are populated, so the five-row home is not producible; report not checked) |
| home, no category has products | not producible without wiping the demo database; report not checked unless a separate empty database is available |
| category, two pages | `/categoria/mantenimiento-del-coche` (the root, 27 products, 2 pages) |
| category, last page | `/categoria/mantenimiento-del-coche?pagina=2` (3 cards) |
| category, one page of 24 | `/categoria/filtros-de-aire` |
| category, one card, no brand, single page | `/categoria/aceite-de-motor` |
| category, empty (200) | `/categoria/filtros-de-combustible` |
| not found | `/categoria/no-existe` and `/categoria/mantenimiento-del-coche?pagina=3` (404) |
| old category slug (404, no redirect) | `/categoria/filtros`, `/categoria/automovil`, `/categoria/herramientas` |
| legal pages, identity set | `/aviso-legal`, `/privacidad`, `/como-nos-financiamos`; needs the fake-env recreate (§ Running the app and taking screenshots) |
| legal page, identity blank | `/aviso-legal` returns 500 with Next's default English error page |
| admin signed in | run the `CLAUDE.md` § Commands `create-admin` command for the e2e admin in `tests/e2e/admin.spec.ts` (credentials are in that file), then sign in with a Playwright script at `/admin/acceso` |
| admin submitting | `page.route` delays the POST to `/admin/acceso*` |
| admin 404 | `/admin/no-existe` (signed in: the admin 404; anonymous: redirect to sign-in) |
| admin shops and feeds page | sign in as the e2e admin, open `/admin/tiendas` at 390 and 1280 wide; re-approve every demo shop and feed you disable, or the e2e import finds no approved feed |
| admin shops and feeds, paused feed and shop note | press "Desactivar tienda" on a demo shop and confirm; its approved feed reads "Aprobado, en pausa" |
| admin shops and feeds, confirm open | press any "Desactivar …" button |
| admin shops and feeds, pending | `page.route` delays the action POST by 1.5 s, then press |
| admin shops and feeds, failed (transport) | `page.route` fulfils the action POST (header `next-action`) with a 500; the page stays and the row shows the error block "No se ha podido guardar el cambio" |
| admin shops and feeds, failed (returned) | `page.route` fulfils the action POST with a `text/x-component` body `0:{a:$@1,f:'',b:<buildId>}` then `1:{status:failed,kind:feed,id:1}` |
| admin shops and feeds, session expired | clear cookies in the context, then press a button; expect `/admin/acceso?aviso=sesion` with the notice |
| admin shops and feeds, shop with no feeds, empty page, longest content | not producible with the demo seed; report not checked |
| demo notice | shown on the demo product, `/categoria/mantenimiento-del-coche`, `?pagina=2`, `/categoria/aceite-de-motor`; absent on home, the empty category, 404 and the legal pages |

Any state this table cannot produce (one offer, a missing image, the longest
title, a product with no offers) is reported as `not checked` with the reason. Never mark
it satisfied. Add a row here through `pack_corrections` when a slice adds a way
to reach a state.

## Guardrails, in design terms

`project.md` § Hard guardrails holds the rules. What they mean for a screen:

- **(2)** A shop link is a plain link to `/go/<offer>`. It may look like a
  button. Never specify that it opens in a new tab.
- **(4)** Every price is the final price with IVA included, and the page says
  so. Never show shipping, a total, or a "from" price that is not an offer's
  price.
- **(5)** No cookies for public visitors, so no cookie banner and no consent
  UI. Fonts are self-hosted (`next/font`), never loaded from a font CDN, which
  would send each visitor's IP address to a third party.
- **(1)** A design never shows a hidden or unapproved item, even greyed out, on
  a public page.

## Spanish market conventions

- All copy is Spanish (`es-ES`): sentence case, *tú* form, plain verbs. A shop
  button says where it goes: "Ir a la tienda".
- Prices: `1.234,50 €`, with the euro sign after the number and a non-breaking
  space before it.
- Dates: "18 oct 2026", in the `Europe/Madrid` time zone.
- Counts use real plurals: "1 tienda", "2 tiendas".
- The site name is configuration. Write `{siteName}` in copy, never "Los Tres".

## Definition of done for this lane

UX mode:

- [ ] Every screen has a phone wireframe, every state the spec names is covered,
      and every string is written out in Spanish
- [ ] Every check names the screenshot observation that would prove it false
- [ ] `direction:` set, and a full `Design system` section written when it is
      not `unchanged`
- [ ] Data needs listed for the tech lead, with absence covered

UX-REVIEW mode:

- [ ] Phone and desktop screenshots of every screen in scope, each opened and
      cited
- [ ] Every spec check marked `SATISFIED`, `GAP`, `DRIFTED` or `not checked`
- [ ] Taste observations in `handoff` as `SHOULD_FIX`, never in the verdict
