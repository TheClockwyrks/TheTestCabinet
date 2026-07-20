## The `window.__shatter` debug API and overlay are required

A new common spec, `specs/instrumentation.md`, requires the build to expose a
debugging and automation API on `window.__shatter` plus a read-only debug overlay
toggled with the backtick key. The simulation must now also be render-free and
drive its randomness off a seedable generator, so a scenario replays identically,
and it holds an `autoStep` flag: `reset()` and `step()` switch to manual stepping
so a script advances the game by exact amounts, while `setAutoStep(true)` hands
the clock back for real-time play. Alongside `snapshot()`, control operations pose
a scenario through the game's real systems, and `keyDown`/`keyUp`/`press` drive it
through the same handling the real keyboard feeds, which is how the controls
themselves are checked. The surface is framed throughout as an ordinary developer
affordance of the game. It is a new mandatory deliverable, hence the major version
bump.

## Specs reorganized around Shatter's own concerns

`specs/field.md` (the field and the star), `specs/ship.md` (the ship and its
bullets), `specs/hazards.md` (the rocks and the saucer), `specs/simulation.md`
(the loop, the gravity well, and collision), and `specs/rules.md` (scoring, lives,
waves, states, controls, audio, and the HUD) replace the previous
playfield/physics/flow split, so each variant's seeded set reads as one
self-contained game. The prose was tightened throughout, and the "key behaviors /
good test targets" listing was removed since the reviewer checklist now covers
those behaviors.

## Reviewer checklist reorganized into categories with automated validation

The checklist moves to the categories grammar (`[review] format = 2`), with every
graded point a leaf item worth one point. Each objective, mechanically verifiable
point is now decided by a validation script that drives `window.__shatter`: it
establishes the point's precondition, steps the real simulation forward, and reads
the outcome back from the snapshot or from the pixels the build actually renders,
synthesizing the proof media as it goes. Feel, art, and audio remain judged by a
person.

## Other changes

- The prompt drops its prescribed verify-before-you-finish checklist; it now
  explains what Playwright and Chromium are there for and leaves how far to
  validate to the model.
- `specs/proof.md` notes that the debug API can set up the exact state each
  capture needs.
- Nothing about how Shatter plays changed.
