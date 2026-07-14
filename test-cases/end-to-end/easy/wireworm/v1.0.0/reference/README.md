# Wireworm — Reference Visuals

These images are the **canonical visual reference** for the Wireworm test case.
Each is a `1280x720` screenshot captured from the case's own **playable
reference-impl build** (the authored, *correct* game under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup.
They serve two purposes: they are seeded into a run as visual targets, and they
are the baselines for any validation check (declared in `../test-case.toml`) that
names the view.

## The reference-impl is the source of truth

Wireworm's reference screenshots are **derived from the real game**. There is no
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

Wireworm has a single `base` variant, so every view is effectively common. The
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
   instance as `window.__wireworm` for exactly this headless capture; it is inert
   during normal play.
3. Drive each view, then screenshot the page:
   - **title** — capture on load (the menu is the default screen).
   - **gameplay** — start a run and pose a representative mid-board frame: a
     built-up node field spanning all four charge states (inert, teal, cyan, and
     white-hot critical), a couple of worms winding down, the defrag cursor firing
     from the bottom band, and a chain-arc discharge mid-detonation.
   - **game-over** — set the game to its game-over state over the same populated
     board so the end card reads the final score and reached level.
4. Write the PNGs to the paths above.

Because the field scatter and worm motion are seeded per play, the `gameplay`
frame differs each capture; any representative frame that clearly shows the
charged field and a worm is fine.
