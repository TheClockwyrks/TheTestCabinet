# Valence — Reference Visuals

These images are the **canonical visual reference** for the Valence test case.
Each is a `1280x720` screenshot captured from the case's own **playable
reference-impl build** (the authored, *correct* game under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup.
They serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that
names the view.

## The reference-impl is the source of truth

Valence's reference screenshots are **derived from the real game**. There is no
separate HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css`
mockups were removed): the reference-impl build *is* the ground truth, and the
screenshots are captured straight from it. The captured images are committed here
and referenced from the manifest as `media` (served as-is), because there is no
longer a mockup for the harness to render at seed time.

This matters more here than in most cases. Valence is a **full-stack** case: the
model under test produces every sprite, particle effect, and sound during the run
with the on-`PATH` asset tools ([`../specs/assets.md`](../specs/assets.md)). The
reference-impl produced its own art the same way, so these frames show matter,
towers, and bursts as genuinely *tool-produced assets* rather than the CSS
stand-ins the old mockups used. They remain targets for **layout, palette, type,
and visual language** — the canonical palette itself is documented in
[`../specs/overview.md`](../specs/overview.md), which is what the specs cite — not
for how any particular sprite is made.

The screenshots are still **rendered, not source**: what a run receives is the
image, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). The reference-impl source itself is shown only on the
case's "Reference" tab (via `reference_implementation` in the variant file) and is
**never seeded into a run** — handing over a correct implementation would let a
model copy it instead of building from the spec.

## Views

Valence has a single `base` variant, so every view is effectively common. The
`title` view is declared in the variant file; `gameplay` and `game-over` are
common (in `../test-case.toml`).

| View slug   | Image                        | Captured from  |
| ----------- | ---------------------------- | -------------- |
| `title`     | `screenshots/base/title.png` | the base build |
| `gameplay`  | `screenshots/gameplay.png`   | the base build |
| `game-over` | `screenshots/game-over.png`  | the base build |

```
reference/screenshots/base/title.png
reference/screenshots/gameplay.png
reference/screenshots/game-over.png
```

Whichever view a run needs, it is seeded into the run under `reference/` keyed by
view slug (the source path here is purely organizational), so the model always
sees a single stable path.

## Regenerating the screenshots

The images are a capture of the reference-impl build, so regenerate them whenever
the build's look changes:

1. Build the reference-impl (`npm ci && npm run build` in `../reference-impl/base`),
   which emits a static site to its `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1), capturing the `#stage` canvas.
   The build exposes its live game instance as `window.__valence` for exactly this
   headless capture (see [`../specs/instrumentation.md`](../specs/instrumentation.md));
   it is inert during normal play. Note that `reset()` and `step()` put the sim on
   the **manual clock** (`autoStep = false`), so nothing advances except by `step()` —
   call `setAutoStep(true)` briefly before a capture that should show motion.
3. Drive each view through that API, then screenshot:
   - **title** — `reset()` and capture; the title menu is the default screen.
   - **gameplay** — a representative mid-round on the branching `junction` map:
     `selectMap("junction")`, `setEnergy` high enough to afford a board, then
     `placeTower` a spread of towers beside both lanes (an Emitter, Cleaver,
     Catalyst and Reactor on one lane; an Ionizer, Moderator and Beam on the other),
     `upgradeTower` one or two so a tier/branch sprite reads, `setRound(22)` and
     `startRound()`. `step()` until the real wave has ~9 units on the board, then
     `spawnUnit` a heavy `isotope`, an inert `noble`, and a bonded `polymer` so the
     full trait language is on screen. `selectTower` one tower so the inspector
     shows, `setEnergy` back down to a believable bank (the placement budget is a
     precondition, not a representative HUD), and `setAutoStep(true)` for ~600 ms so
     projectiles and bursts are genuinely mid-flight.
   - **game-over** — a real containment failure: start a run, place a few towers,
     `startRound()` and `step()` until the score has genuinely accumulated (~1500),
     then `setIntegrity(3)` and `spawnUnit` an atom just short of the collector.
     Step until `snapshot().screen === "defeat"` so the end card is reached through
     the real containment check, never posed.
4. Write the PNGs to the paths above.

Everything above drives the real game through its real debug surface; no frame is
hand-painted or fabricated. Because a round's spawn timing and the particle scatter
run off the seeded generator and the live-clip hand-off uses the wall clock, the
`gameplay` and `game-over` frames differ slightly each capture; any representative
frame that clearly shows a live board (or a real defeat card over a played board)
is fine.
