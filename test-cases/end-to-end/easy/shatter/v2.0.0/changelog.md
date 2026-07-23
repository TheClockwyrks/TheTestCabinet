## The `window.__shatter` debug API and overlay are required

A new common spec, `specs/instrumentation.md`, requires the build to expose a
`window.__shatter` debugging and automation API plus a read-only overlay toggled
with the backtick key, backed by a render-free core with seedable randomness and an
`autoStep` flag: `reset()`/`step()` switch to manual stepping while
`setAutoStep(true)` hands the clock back for real-time play, so a scenario replays
identically. A new mandatory deliverable, hence the major bump.

## Specs reorganized around Shatter's own concerns

`specs/playfield.md`, `specs/ship.md`, `specs/hazards.md`, `specs/simulation.md`,
`specs/gameplay.md`, and `specs/ui.md` replace the previous playfield/physics/flow
split, so each variant's seeded set reads as one self-contained game. The per-variant
mode spec is gone: the standard-vs-Warhead differences are now branched by variant
slug inside `specs/gameplay.md.hbs` and `specs/ui.md.hbs`. The prose was tightened
throughout.

## Reviewer checklist reorganized into categories with automated validation

The checklist moves to the categories grammar (`[review] format = 2`), with every
graded point a one-point leaf item. Each mechanically verifiable point is decided by
a validation script that drives `window.__shatter` — establishing the precondition,
stepping the real simulation, and reading the outcome back from the snapshot or the
rendered pixels. Feel, art, and audio remain reviewed by a person.

## Other changes

- The prompt drops its prescribed verify-before-you-finish checklist; it now explains
  what Playwright and Chromium are there for and leaves how far to validate to the
  model.
- `specs/proof.md` notes that the debug API can set up the exact state each capture
  needs.
- Warhead: losing a ship now refills the torpedo — a respawned ship comes back with
  its torpedo charged, cancelling any recharge in progress (previously the recharge
  kept counting through a death and respawn). The base game is unchanged.
