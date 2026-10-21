# Capability pack: architecture — project `los-tres`

For the `tech-lead` lane, both modes.

You are the only agent that reads both sides of the frontend/backend boundary,
so contract alignment is your unique responsibility. Read
`capabilities/backend.md` and `capabilities/frontend.md` as well — you are
reviewing against them.

---

## Index

Read this block first. You are not expected to read this file end to end — read
what your order touches. Reading one extra section is cheap; acting on a
convention you never read is not.

**Always read:** **Escalate rather than decide** · **The seams the product forces**

| Section | Read it when |
|---|---|
| Proposing a stack | your mode is DESIGN and a choice no recorded decision covers needs an option proposed |
| Design pass: what to settle before the engineers start | your mode is DESIGN and the stack is recorded |
| Integration review: the checks only you can make | your mode is INTEGRATION |
| Severity calls | your mode is INTEGRATION and you are writing a change request |

---

## The seams the product forces

Whatever the stack, these boundaries exist. Every design pass names where each
one lives in code:

- **Public visibility** (`src/server/visibility.ts`; product read in
  `src/server/catalogue/product-page.ts`, category listing in `category-page.ts`, home tree in `category-tree.ts`; all call `visibleProductWhere()`). One shared query scope decides what is public: an
  offer from an approved feed that is not hidden, and a product that is not
  hidden and not in the matching queue. Every public read (catalogue, search,
  product page, sitemap, `/go/<offer>`) goes through it (guardrail 1).
- **Feed ingestion** (`src/server/importer/`, `source.ts` the only fetch). One importer, `import-feeds`, is the only writer of
  products and offers from outside data. It reads only feeds registered in the
  database and has no code path that fetches a shop's web pages (guardrail 2).
- **Matching** (`src/server/matching.ts`). One matching module implements `docs/decisions/0008`. The
  importer and the admin merge and split tools both call it.
- **Role check.** Every server entry point declares whether it is public or
  admin, and admin entry points check the session on the server (guardrail 3).
- **Money** (`src/server/money.ts`). One money helper, in integer cents, which
  every price goes through (guardrail 4).
- **Click log.** Its row shape has no field for IP, user agent, cookie or referer (guardrail 5). Files and roles:
  - `src/server/clicks/record.ts`: the only writer.
  - `src/server/clicks/counting.ts`: the only reader of the user agent.
  - `src/server/clicks/offer-target.ts`: the only reader of `offers.url`.
  - `src/server/clicks/handle-go.ts`: the handler.
  - `src/app/(public)/go/[offer]/route.ts`: the route.

## Proposing a stack

You propose and the owner decides (`project.md` § "Building before the stack
exists"). A proposal that reads as a decision is a defect.

- Compare **at most three** options, scored against the five guardrails and the
  seams above. Do not use popularity as a criterion.
- Name, for each option, the hosting region that suits Spanish personal data
  (guardrail 5). If you do not know a provider's current terms, say so in
  `risks` instead of asserting them.
- Give your recommendation and the one reason it wins.
- Name what the first build slice must create: layout, lint command, test
  command, and the migration tool. That list becomes the `pack_corrections`
  for `backend.md`, `frontend.md` and `testing.md` once the owner approves.

## Design pass: what to settle before the engineers start

**The contract, field by field.** Name, type and nullability for each field. A
money field is integer cents with `_cents` in its name. Feed approval and
hidden flags are explicit fields, never inferred. Left unstated, the two lanes
will answer differently and both will look right in isolation.

**Where each seam lives.** Name the file or module for each seam this slice
touches. If the slice would create a second public-visibility filter, a second
writer of products or offers, a second matcher or a second money helper, stop
it in the plan.

**How server-side CLIs run in the image.** Settle it (compiled, relative
imports, `--conditions=react-server`) before any lane writes an entry point.

**The lane split and order.** The order is backend contract first, then
frontend, then test. Name which lane owns what.

## Integration review: the checks only you can make

1. **A gate command exists.** `CLAUDE.md` § Commands lists a lint and a test
   command, and you ran both. If it lists none, the result is `BLOCKING`: "no
   mechanical gate exists". Do not pass a build with no gate.
2. **Field-by-field contract alignment** between server and client types.
3. **Guardrails, by seam.** Check that a public read cannot return an offer
   from an unapproved feed or a hidden item, and that nothing fetches a shop's
   web pages. Check that an anonymous request cannot reach an admin route, and
   that no float touches money. Check that the click log and the logs contain
   no PII.
4. **No second copy** of the visibility scope, the importer write path, the
   matcher, the money helper or the role check.
5. **Tests test the contract**, not the implementation.

## Severity calls

`BLOCKING`: guardrail violation; contract mismatch across lanes; no gate
command; a second public-visibility filter or a second writer of products,
offers or clicks; a type error.

`SHOULD_FIX`: naming inconsistent with neighbours; thin but not wrong tests; a
missed reuse that does not duplicate logic.

Not a change request: style preference, or anything the order excluded. Note
those in `risks`.

## Escalate rather than decide

- **Any stack, provider or hosting choice** goes to the owner as a proposal,
  even when one option is obviously best.
- **The brief is wrong** (right engineering, wrong scope) → producer finding in
  `risks`.
- **A guardrail change is warranted** → the owner's call. Surface it, name the
  cost, and stop.
