This release adds a required **debugging and automation surface** to every variant,
so the game can be driven and inspected from code rather than only by hand, and moves
the reviewer checklist onto that surface for automated validation. It is a new,
mandatory deliverable, hence the major version bump. How Shatter plays is unchanged:
inertial flight, the central gravity well, the rocks and their splitting and
recycling, the escalating waves, the hunting saucer, lives and respawns, scoring, and
the full state machine are all as before, for both the standard and Warhead variants.

## New: the `window.__shatter` debug API and overlay

A new common spec, `specs/instrumentation.md` (seeded for every variant), requires the
build to expose a small debugging and automation API on `window.__shatter` and a
read-only debug overlay:

- **Deterministic, steppable core.** The simulation was already fixed-timestep; it now
  must also be render-free (state advances by stepping it, with no dependence on the
  canvas or wall-clock time) and drive all randomness off a seedable generator, so a
  scenario replays identically.
- **A manual clock.** The game holds an `autoStep` flag (true during normal play);
  `reset()` and `step()` switch to manual stepping so a scripted scenario advances by
  exact amounts, and `setAutoStep(true)` hands the clock back so the game runs itself
  in real time again for watching or recording.
- **`window.__shatter`** — core operations `reset(options)`, `step(seconds)`,
  `setAutoStep(enabled)`, and a JSON-serializable `snapshot()`, plus control operations
  that set up a scenario through the game's real systems: `startGame`, `setScore`,
  `setLives`, `setInvuln`, `setShip`, `clearRocks`, `addRock`, `addBullet`,
  `spawnSaucer`, `setSaucer`, `removeSaucer`, and (Warhead) `setTorpedoReady`.
- **Input injection** — `keyDown(code)`, `keyUp(code)`, and `press(code)` drive the
  game through the same handling the real keyboard feeds, so the menus, flying,
  shooting, pausing, and mute can be driven exactly as a player would, which is how the
  controls themselves are checked.
- **Debug overlay** — a read-only on-screen display of the live internal state,
  toggled with the backtick key, off by default, never affecting gameplay.

The `specs/overview.md` hard-requirements list and file map, the `prompt.hbs` build
instructions, and `specs/proof.md` (which now notes the debug API can set up the exact
state each capture needs) are updated to match. The surface is framed throughout as an
ordinary developer affordance of the game.

## Specs reorganized and cleaned

The specification is reorganized around Shatter's own concerns rather than generic
names: `specs/field.md` (the field and the star), `specs/ship.md` (the ship and its
bullets), `specs/hazards.md` (the rocks and the saucer), `specs/simulation.md` (the
loop, the gravity well, and collision), and `specs/rules.md` (scoring, lives, waves,
states, controls, audio, and the HUD) replace the previous playfield/physics/flow
split. Each variant's seeded set reads as one self-contained game. The prose was
tightened throughout and the "key behaviors / good test targets" listing was removed,
since those behaviors are now covered by the reviewer checklist.

## Reviewer checklist reorganized into categories with automated validation

The reviewer checklist moves to the categories grammar (`[review] format = 2`), grouped
into categories with every graded point a leaf item worth one point, and each
objective, mechanically-verifiable point is now decided by an automated validation
script that drives `window.__shatter`: it establishes the point's precondition through
the debug API, steps the real simulation forward, and reads the outcome back from the
snapshot or from the pixels the build actually renders, synthesizing the proof media as
it goes. Feel, art, and audio remain judged by a person.
