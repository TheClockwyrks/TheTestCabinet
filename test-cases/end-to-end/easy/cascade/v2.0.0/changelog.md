## The build must expose a `window.__cascade` API and a debug overlay

A new common spec, `specs/instrumentation.md`, seeded for every variant, requires
a deterministic, seedable, render-free core behind a `window.__cascade` API — core
operations, a JSON-serializable snapshot, control operations that pose a board and
drive the real rules, a `selectMenu`, and injected pointer input — plus a read-only
overlay toggled with the backtick key. An `autoStep` flag decides whether the
victory cascade advances from the wall clock or by hand, so a scripted cascade is
exact. A new mandatory deliverable, hence the major bump.

## The reviewer checklist is reorganized into categories with automated validation

The checklist now uses the categories grammar (`[review] format = 2`), with every
graded point a one-point item and most carrying a validation script that drives the
build through `window.__cascade` and decides its own verdict. The deal, foundation,
tableau, run, stock and waste, auto-move, win-detection, and victory-cascade
behaviors are each checked more finely than before; presentation stays
reviewer-judged.

## The seeded specs are renamed and tightened

`layout.md` became `table.md`, `flow.md` became `states.md`, and `cascade.md`
became `victory.md`. The per-variant deal-mode spec is gone: its turn count, waste
fan, and menu label are now a variant branch inside `specs/rules.md.hbs`. Historical
and edge-case call-outs were removed so each variant's seeded set reads as one
self-contained game.

## Other changes

- The prompt's mandatory verification pass is replaced by a note that Playwright
  and Chromium are available for driving and validating the build, leaving their use
  to the model's judgment.
- `specs/proof.md` drops the validator and review-UI framing; the captures and their
  fixed paths are unchanged.
- `specs/overview.md` drops the "inspired by classic patience card games" framing.
- Touchscreen support is now a hard requirement: the game must be fully playable
  with a mouse and on a touchscreen alike (v1 listed touch as out of scope).
