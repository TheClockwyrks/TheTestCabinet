# Arc Foundry — Reference Visuals

These images are the **canonical visual reference** for the Arc Foundry test case.
Each is a `1280x720` screenshot captured from the case's own **playable
reference-impl build** (the authored, *correct* game under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup.
They serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that
names the view.

## The reference-impl is the source of truth

Arc Foundry's reference screenshots are **derived from the real game**. There is no
separate HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css`
mockups were removed): the reference-impl build *is* the ground truth, and the
screenshots are captured straight from it. The captured images are committed here
and referenced from the manifest as `media` (served as-is), because there is no
longer a mockup for the harness to render at seed time.

This matters more here than on a plain end-to-end case. Arc Foundry is a
**full-stack** case: every sprite, sheet, and electrical particle system on screen
is a **produced asset** the reference-impl authored with the on-`PATH` tools (see
[`../specs/assets.md`](../specs/assets.md)). Capturing the real build means the
reference shows the actual produced art — the component ladder, the blockers, the
waypoint platforms, the bolts and discharge rings — rather than a CSS stand-in for
it. The palette, type, and board furniture that `theme.css` used to hold now live
in the build itself and in the seeded specs, which remain the written authority.

The screenshots are still **rendered, not source**: what a run receives is the
image, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). The reference-impl source itself is shown only on the
case's "Reference" tab (via `reference_implementation` in the variant file) and is
**never seeded into a run** — handing over a correct implementation would let a
model copy it instead of building from the spec.

## Views

Arc Foundry has a single `base` variant. The `map-select`, `gameplay`, and
`game-over` views are **common** (declared in `../test-case.toml`); the `title`
view is **variant-specific** (declared in `../variants/base.toml`), because the
main menu lists the variant's own start.

| View slug    | Image                             | Captured from  | Scope       |
| ------------ | --------------------------------- | -------------- | ----------- |
| `title`      | `screenshots/base/title.png`      | the base build | per variant |
| `map-select` | `screenshots/map-select.png`      | the base build | common      |
| `gameplay`   | `screenshots/gameplay.png`        | the base build | common      |
| `game-over`  | `screenshots/game-over.png`       | the base build | common      |

```
reference/screenshots/base/title.png
reference/screenshots/map-select.png
reference/screenshots/gameplay.png
reference/screenshots/game-over.png
```

These images are **tracked in git**, not a build output: they are what the manifest
serves, so they must be committed. (`reference/.rendered/` — the harness's old
seed-time render cache — is the ignored directory, and no longer applies now that
nothing is rendered.)

Whichever view a run needs, it is seeded into the run under `reference/` keyed by
view slug (the source path here is purely organizational), so the model always sees
a single stable path.

## Regenerating the screenshots

The images are a capture of the reference-impl build, so regenerate them whenever
the build's look changes:

1. Build the reference-impl (`npm ci && npm run build` in `../reference-impl/base`),
   which emits a static site to its `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1). The build exposes its live game
   instance as `window.__foundry` for exactly this headless capture (the API in
   [`../specs/instrumentation.md`](../specs/instrumentation.md)); it is inert during
   normal play. Drive with the **manual clock**: `reset`/`step` turn `autoStep` off,
   so `step(seconds)` advances an exact amount of game time and the capture does not
   depend on machine load.
3. Drive each view, then screenshot the page:
   - **title** — `reset({ seed })` and capture; the title menu is the default screen.
   - **map-select** — `reset({ seed })`, then `press("Enter")` to confirm `SALVAGE`,
     which opens the three-map picker.
   - **gameplay** — `startRun({ map: "substation", difficulty: "medium" })`, then
     build a real board over several levels: per level `setNextRoll(type, quality)` +
     `placeRock(col, row)` for a few rocks, then `keep(id)` one candidate (the
     level's single harvest, which sends the wave) and `step` until the wave clears.
     Anchor the rocks **near the waypoint chain** (`entry`, `waypoints`, `collector`
     from `snapshot()`) so the towers ring the route and the leftovers read as a maze
     of blockers, rather than clumping in a corner. Then `spawnUnit` a mixed pack in
     trickles — scaled to a high `wave` so it survives long enough to cross the yard
     — and `step(0.25)` until the Load is strung out along the chain with towers
     firing. Select a firing component **near the middle of the yard** so the
     inspector reads its stats and its range ring lands fully on-board.
   - **game-over** — from that same board, `setIntegrity(3)` and `spawnUnit` units
     scaled far past the board's damage output, then `step` until they leak the grid
     to zero and the screen becomes `overload`. Capture the real defeat panel over
     the dimmed board; do not fake the end state.
4. Write the PNGs to the paths above.

The simulation is seeded and steppable, so a fixed seed and a fixed call sequence
reproduce the same state. The captures are still not byte-identical between runs —
the frame drawn at capture time includes wall-clock-driven VFX (bolt, ring, and
aura animations) that do not advance on the manual clock alone. Any representative
frame is fine: `gameplay` should clearly show a mazed board mid-wave with the Load
on the route and towers firing, and `game-over` the OVERLOAD panel over a real
played-out board.
