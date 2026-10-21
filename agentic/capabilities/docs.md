# Capability pack: docs — project `los-tres`

For the `docs-engineer` lane. Runs at close-out, after the `integration` gate
(and `ux-review` when a screen changed, and `review` when a story exists)
passes, or after a framing-only or
stack run that the owner approved.

**Never run this lane on unverified work.** This lane propagates correctness
into the docs. Running it on a broken implementation spreads broken claims into
the project's sources of truth.

---

## Index

Read this block first. You are not expected to read this file end to end — read
what your order touches. Reading one extra section is cheap; acting on a
convention you never read is not.

**Always read:** **Where things live** · **What not to do** · **Definition of done for this lane**

| Section | Read it when |
|---|---|
| Recording an owner decision | the run's `decisions.md` holds an approved MVP scope or stack choice |
| Recording the design system | the run's UX spec says `direction: new` or `direction: changed` |
| The second close-out order: applying pack corrections | your order is a close-out pack-corrections order |

---

## Where things live

| Path | What lives there |
|---|---|
| `docs/product/mvp.md` | approved MVP scope: in, out, settled owner calls |
| `docs/decisions/NNNN-<topic>.md` | one recorded decision each: context, options, the owner's choice, consequences |
| `docs/design/system.md` | the design system the human approved: principles, tokens, components, copy voice |
| `CLAUDE.md` § Stack, § Commands | the summary every lane loads at startup |

## Recording an owner decision

Write it from `decisions.md`, in the owner's words, never from a proposal the
owner did not approve. A stack decision produces a `docs/decisions/` file
**and** the matching `CLAUDE.md` § Stack line, both in the same order. Change
nothing else in `CLAUDE.md`.

## Recording the design system

When the run's UX spec says `direction: new` or `direction: changed` and
`decisions.md` records the human's approval, write `docs/design/system.md` from
the spec's `Design system` section. Copy it; do not edit the design. If the
human approved it with changes, the changes in `decisions.md` win.

## The second close-out order: applying pack corrections

This order scopes you to `agentic/capabilities/`, with
`<run_dir>/pack-corrections.md` as its input. Nothing else is in scope on it. How to apply an entry is
`protocol/packs.md` § Applying corrections, which you read on this order.

Expect many corrections in the first runs. Each first slice fills an empty
`Layout` or `Running tests` section, and that is the loop working.

## What not to do

- **Never invent a field, a command or a decision.** If something is unclear,
  it goes in `risks`.
- **Do not tidy adjacent docs.** Out-of-scope doc changes hide the real diff.
- **Do not report success on a partial reconciliation.** Say which items
  landed and which were flagged.

## Definition of done for this lane

- [ ] Every owner decision in `decisions.md` recorded where the table above
      says, or flagged
- [ ] `CLAUDE.md` § Commands matches any script added, renamed or removed
- [ ] Every `contract_note` landed or explicitly dismissed with a reason
- [ ] Nothing ticked that the reviewer did not confirm
