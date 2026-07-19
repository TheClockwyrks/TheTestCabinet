This release adds a required **debugging and automation surface** to every
variant, so the dark trench can be driven and inspected from code rather than only
by hand, and it pairs that surface with an automated-validation pass over the
checklist. It is a new, mandatory deliverable, hence the major version bump. The
seeded specification was also cleaned up so each dive reads as one self-contained,
fully authoritative game.

## New: the `window.__fathom` debug API and overlay

A new common spec, `specs/instrumentation.md` (seeded for every variant), requires
the build to expose a small debugging and automation API on `window.__fathom` and
a read-only debug overlay:

- **Deterministic, steppable core.** `specs/movement.md` already required a fixed
  timestep decoupled from rendering; the core is now also required to be
  **render-free** (state advances by stepping it, with no dependence on the canvas
  or wall-clock time) and any randomness (predator and drifter wander, spawn
  cadence) must run off a **seedable** generator, so a scenario replays identically.
- **Manual clock.** The simulation carries an `autoStep` flag (default on, for
  normal play). `reset()` and `step(seconds)` switch it off so the driver's clock
  is the sole source of time, and `setAutoStep(true)` lets the game run live again,
  so a scripted scenario is exact and reproducible regardless of machine load.
- **`window.__fathom`** — core operations `reset(options)`, `step(seconds)`,
  `setAutoStep(enabled)`, and a JSON-serializable `snapshot()` (the full observable
  state, including the maze grid and per-tile visibility), plus control operations
  that set up a scenario through the game's real systems (`startDive`, `beginPlay`,
  `setDepth`, `setForager`, `setBrightness`, `setPredator`, `spawnDrifter`,
  `poseLastPlankton`, `clearCooldowns`) and input injection (`keyDown`, `keyUp`,
  `press`) that flows through the real key handling.

## New: automated validation

Every mechanical checklist item now carries a `validation` script that drives the
real, deterministic simulation through `window.__fathom` and decides the item's
verdict automatically, capturing side-by-side media. The reviewer still rates the
qualitative parts (feel, art, audio, layout) by hand and can override any
auto-verdict. The checklist moves to the categories grammar (`[review] format = 2`)
and is expanded well beyond the v1 list to cover every spec-mandated observable
behavior.

## Specification cleanup

- The specs are now fully authoritative and self-contained, with the historical
  and "earlier build" framing removed (that history lives only here in the
  changelog). Emphasis and interrupting asides were pared back for readability.
- `specs/playfield.md` was renamed to `specs/trench.md` and `specs/flow.md` to
  `specs/progression.md`, natural names for this game; cross-references and the
  manifest were updated to match.
- Edge-case call-outs were removed from the specs. Where an edge case needs
  particular behavior, the rule is stated plainly; otherwise handling it is the
  build's job and is checked by a review item.
- The prompt no longer prescribes a verification routine. It states that Playwright
  and Chromium are installed and how to launch them, and leaves whether and how far
  to validate to the build.
