# Deepcore — Reference Visuals

These images are the **canonical visual reference** for the Deepcore test case. Each is a
`1280x720` screenshot captured from the case's own **playable reference-impl build** (the
authored, *correct* game under [`../reference-impl/`](../reference-impl/)) — not from a
hand-authored mockup. They serve two purposes: they are seeded into a run as visual
targets, and they are the baselines for any validation check (declared in
`../test-case.toml`) that names the view.

## The reference-impl is the source of truth

Deepcore's reference screenshots are **derived from the real game**. There is no separate
HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css` mockups were removed):
the reference-impl build *is* the ground truth, and the screenshots are captured straight
from it. The captured images are committed here and referenced from the manifest as
`media` (served as-is), because there is no longer a mockup for the harness to render at
seed time.

This case is **full-stack**, so the build also produced its own art, animation, VFX, and
audio during authoring (committed under `../reference-impl/base/assets/`). Every element
these frames show is therefore the real produced asset, not a CSS stand-in: the band
tiles, ore veins, material nodes, hazards, buildings, and rocket are `draw` sprites; the
**miner** is a set of `draw-sheet` cycles (here caught mid-`drill-down`); the effects are
live `particle-2d` systems (see [`../specs/assets.md`](../specs/assets.md)). The canonical
palette and type the frames use are defined in
[`../specs/overview.md`](../specs/overview.md), which is the authority for both — not this
folder.

The screenshots are still **rendered, not source**: what a run receives is the image,
seeded as a visual target alongside the seeded specs under [`../specs/`](../specs/). The
reference-impl source itself is shown only on the case's "Reference" tab (via
`reference_implementation` in the variant file) and is **never seeded into a run** —
handing over a correct implementation would let a model copy it instead of building from
the spec.

## Views

Deepcore has a single `base` variant. The `title` view is declared in the variant file
(the main menu is variant-specific); `mine`, `surface`, and `game-over` are common (in
`../test-case.toml`).

| View slug   | Image                        | Captured from  |
| ----------- | ---------------------------- | -------------- |
| `title`     | `screenshots/base/title.png` | the base build |
| `mine`      | `screenshots/mine.png`       | the base build |
| `surface`   | `screenshots/surface.png`    | the base build |
| `game-over` | `screenshots/game-over.png`  | the base build |

```
reference/screenshots/base/title.png
reference/screenshots/mine.png
reference/screenshots/surface.png
reference/screenshots/game-over.png
```

Whichever view a run needs, it is seeded into the run under `reference/` keyed by view
slug (the source path here is purely organizational), so the model always sees a single
stable path — `reference/title.png`, `reference/mine.png`, and so on.

## Regenerating the screenshots

The images are a capture of the reference-impl build, so regenerate them whenever the
build's look changes:

1. Build the reference-impl (`npm ci && npm run build` in `../reference-impl/base`), which
   emits a static site to its `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a `1280x720`
   viewport (device scale factor 1), and capture the `#stage` canvas. The build exposes
   its live game instance as `window.__deepcore`
   ([`../specs/instrumentation.md`](../specs/instrumentation.md)) for exactly this headless
   capture; it is inert during normal play. Call `setMuted(true)` first, and note that
   `reset()`/`step()` put the sim on the caller's clock (`autoStep` false), so a posed
   frame is exact. Every frame below is posed with the **control** operations, which
   arrange the world and then let the **real** systems run — never fabricate a frame.
3. Drive each view, then capture:
   - **title** — `reset({ seed })`; the main menu is the default screen on load.
   - **mine** — `startExpedition("standard", "standard")`, `grantGear(...)` and
     `grantCredits(...)` for a mid-run HUD, then `setTile` a carved shaft and two side
     tunnels above a deepstone row (~row 310), scatter a few ore veins, a `resonite`
     material node and a lava tile in frame, `addCargo(...)` a haul, `teleport` onto solid
     floor at the shaft bottom, and `setFuel(...)` about half a tank. Then
     `keyDown("ArrowDown")` and `step(~0.35)` so the **real drill system** catches the
     miner mid-cut (`snapshot().miner.drilling.progress` around 0.5) with the scanner
     indicator locked onto the node.
   - **surface** — `startExpedition(...)`, `grantCredits(...)`, `giveMaterial("resonite")`
     and `giveMaterial("cryenite")`, then `fabricate()` twice so the rocket reads partly
     assembled, `teleport` to the Launch Pad (col 28) and `openPanel("launch-pad")`. That
     panel shows the five-part escape rocket — the case's win condition — over the dimmed
     camp. (The camp is wider than the viewport, so any surface frame shows a slice of it.)
   - **game-over** — `startExpedition(...)`, `grantCredits(...)` a plausible haul,
     `fabricate()`, then `step(~370)` on the safe surface so **Elapsed time** reads like a
     real expedition, `teleport` deep, and `setHull(0)`. Step in small chunks until
     `snapshot().screen === "game-over"`: the end card is produced by the **real death
     path**, and its summary reports the run that actually happened.
4. Write the PNGs to the paths above.

Keep the posed values plausible — the summary, the HUD, and the panel are read straight
off the frame, so an impossible balance (a five-figure credit total on a two-second run)
reads as wrong even though the state is genuine. Because the mine is generated per seed
and the miner is posed by hand, the `mine` and `surface` frames differ between captures;
any representative frame that clearly shows a live dig and the camp is fine.
