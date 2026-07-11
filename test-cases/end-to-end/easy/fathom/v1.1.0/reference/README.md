# Fathom — Reference Visuals

These images are the **canonical visual reference** for the Fathom test case. Each
is a `1280x720` screenshot captured from the case's own **playable reference-impl
builds** (the authored, *correct* games under
[`../reference-impl/`](../reference-impl/)) — not from a hand-authored mockup. They
serve two purposes: they are seeded into a run as visual targets, and they are the
baselines for any validation check (declared in `../test-case.toml`) that names the
view.

## The reference-impl is the source of truth

Fathom's reference screenshots are **derived from the real games**. There is no
separate HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css`
mockups were removed): the reference-impl builds *are* the ground truth, and the
screenshots are captured straight from them — so each image shows the actual art
and the real fog/light/sonar rendering the build produces. The captured images are
committed here and referenced from the manifest as `media` (served as-is), because
there is no longer a mockup for the harness to render at seed time.

The screenshots are still **rendered, not source**: what a run receives is the
image, seeded as a visual target alongside the seeded specs under
[`../specs/`](../specs/). The reference-impl source itself is shown only on the
case's "Reference" tab (via `reference_implementation` in the variant files) and is
**never seeded into a run**.

## Views

The `title`, `gameplay`, `game-over`, and `sonar` views are **common** — captured
from the `base` build and seeded for every variant (both variants share the same
single-dive menu and the same Base sensing look for these). The Kindle variant adds
one **Kindle-only** view, `vision-circle`, captured from the `kindle` build, for the
one thing that sets it apart.

| View slug       | Image                                  | Captured from  | Scope       |
| --------------- | -------------------------------------- | -------------- | ----------- |
| `title`         | `screenshots/title.png`                | `base` build   | common      |
| `gameplay`      | `screenshots/gameplay.png`             | `base` build   | common      |
| `game-over`     | `screenshots/game-over.png`            | `base` build   | common      |
| `sonar`         | `screenshots/sonar.png`                | `base` build   | common      |
| `vision-circle` | `screenshots/kindle/vision-circle.png` | `kindle` build | Kindle only |

```
reference/screenshots/title.png                  # common
reference/screenshots/gameplay.png               # common — lit pocket, LOS light, fog memory
reference/screenshots/game-over.png              # common
reference/screenshots/sonar.png                  # common — the sonar wavefront mid-flight
reference/screenshots/kindle/vision-circle.png   # Kindle only — the outer vision circle
```

- **`gameplay`** shows the intended look of the dark trench: a lit pocket of
  revealed corridors fading into black fog around the forager, plankton in the
  corridors, an amber light glimpsed in the dark, and the HUD.
- **`sonar`** captures a sonar pulse mid-flight — the travelling wavefront flooding
  the corridors as glowing arcs, reaching past the light to reveal terrain beyond
  the line-of-sight pocket. (It is the still counterpart to the `proof/sonar.webm`
  clip the build submits.)
- **`vision-circle`** is the Kindle dive's defining in-trench look: a wide, crisp
  circular window of the explored trench centered on a well-fed (bright) forager,
  pitch black beyond it — even over ground already explored.

Seeding is keyed by the view slug, so the source path here is purely
organizational; whichever variant a run selects, `title.png` is seeded as
`reference/title.png`, and so on.

## Regenerating the screenshots

The images are a capture of the reference-impl builds, so regenerate them whenever
a build's look changes:

1. Build the reference-impls (`npm ci && npm run build` in `../reference-impl/base`
   and `../reference-impl/kindle`), which emits a static site to each `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1). Each build exposes its live game
   instance as `window.__fathom` for exactly this headless capture; it is inert
   during normal play.
3. Drive each view, then screenshot the `#stage` canvas. Start a dive by pressing
   `Enter` (the `DIVE` menu item) and wait out the ~2.1 s dive countdown, then use
   real key input (`Arrow` keys, `Space`) so the fog, light, and sonar behave
   exactly as in play:
   - **title** — capture on load (after assets finish loading).
   - **gameplay** — after the dive, hold arrow keys to open a lit pocket and eat a
     few plankton, then capture.
   - **sonar** — from a revealed gameplay frame, press `Space` and capture ~0.38 s
     later, while the wavefront (≈14 tiles/s, range ≈9) is still travelling out.
   - **game-over** — render the real end panel: set `g.score`, `g.depth`, and
     `g.state = 6` (`GameState.GameOver`), then capture.
   - **vision-circle** (kindle build) — explore broadly to reveal a wide region,
     then depict a well-fed forager at full glow (`g.forager.g = 1`,
     `g.brightHold = 1`) so the outer vision circle opens to its full ~10-tile
     radius before capturing.
4. Write the PNGs to the paths above (all common views from `base`; the
   `vision-circle` from `kindle`).

The maze, plankton, and predator schedule are fixed, so frames are stable up to
minor predator/drifter wander; any representative frame that clearly shows the view
is fine.
