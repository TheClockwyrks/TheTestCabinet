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

`specs/playfield.md` (the field and the star), `specs/ship.md` (the ship and its
bullets), `specs/hazards.md` (the rocks and the saucer), `specs/simulation.md`
(the loop, the gravity well, and collision), `specs/gameplay.md` (scoring, lives,
waves, how rocks take damage, the weapons, and the controls), and `specs/ui.md` (the
menus and game states, the HUD, and audio) replace the previous
playfield/physics/flow split, so each variant's seeded set reads as one
self-contained game. The per-variant mode spec (`specs/mode.md`) is gone: the
standard-vs-Warhead differences are now branched by variant slug inside
`specs/gameplay.md.hbs` and `specs/ui.md.hbs`, so no separate mode file is seeded. The
prose was tightened throughout, and the "key behaviors / good test targets" listing
was removed since the reviewer checklist now covers those behaviors.

## Reviewer checklist reorganized into categories with automated validation

The checklist moves to the categories grammar (`[review] format = 2`), with every
graded point a leaf item worth one point. Each objective, mechanically verifiable
point is now decided by a validation script that drives `window.__shatter`: it
establishes the point's precondition, steps the real simulation forward, and reads
the outcome back from the snapshot or from the pixels the build actually renders,
synthesizing the proof media as it goes. Feel, art, and audio remain reviewed by a
person.

## Other changes

- The prompt drops its prescribed verify-before-you-finish checklist; it now
  explains what Playwright and Chromium are there for and leaves how far to
  validate to the model.
- `specs/proof.md` notes that the debug API can set up the exact state each
  capture needs.
- Warhead: losing a ship now refills the torpedo — a respawned ship comes back with
  its torpedo charged and ready, cancelling any recharge in progress (previously the
  recharge kept counting through a death and respawn). The base game is unchanged, and
  nothing else about how Shatter plays changed.
