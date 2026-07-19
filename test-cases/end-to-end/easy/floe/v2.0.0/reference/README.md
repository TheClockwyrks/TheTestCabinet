# Floe — Reference Visuals

These images are the **canonical visual reference** for the Floe test case.
Each is a `1280x720` screenshot captured from the case's own **playable
reference-impl build** (the authored, *correct* game under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup.
They serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that
names the view.

## The reference-impl is the source of truth

Floe's reference screenshots are **derived from the real game**. There is no
separate HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css`
mockups were removed): the reference-impl build *is* the ground truth, and the
screenshots are captured straight from it. The captured images are committed here
and referenced from the manifest as `media` (served as-is), because there is no
longer a mockup for the harness to render at seed time.

The screenshots are still **rendered, not source**: what a run receives is the
image, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). The reference-impl source itself is shown only on the
case's "Reference" tab (via `reference_implementation` in the variant file) and is
**never seeded into a run** — handing over a correct implementation would let a
model copy it instead of building from the spec.

## Views

Floe has a single `base` variant, so every view is effectively common. The
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
   `1280x720` viewport (device scale factor 1). The build exposes its live game
   instance as `window.__floe` for exactly this headless capture; it is inert
   during normal play.
3. Drive each view, then screenshot the page:
   - **title** — capture on load (the menu is the default screen).
   - **gameplay** — start a crossing and pose a representative mid-strait frame:
     the critter partway across among the sliding ice-band vehicles and the
     drifting water-band floes, the pursuing bear nearby, and the HUD (score,
     lives, bay markers, timer, level) with a couple of bays filled.
   - **game-over** — set the game to its game-over state so the end card reads the
     final score and reached level over the dimmed strait.
4. Write the PNGs to the paths above.

Because the lanes and the bear are seeded per play, the `gameplay` frame differs
each capture; any representative frame that clearly shows an in-progress crossing
is fine.
