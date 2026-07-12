# Coil — Reference Visuals

These images are the **canonical visual reference** for the Coil test case. Each is
a `1280x720` screenshot captured from a **playable Coil build** — the real game,
driven with Playwright — not from a hand-authored mockup. They serve two purposes:
they are seeded into a run as visual targets, and they are the baselines for any
validation check (declared in `../test-case.toml`) that names the view.

## The playable build is the source of truth

Coil's reference screenshots are **derived from a real game**, so each image shows
the actual produced sprite set (the biting head, the straight-body tube, the corner
sprites at each bend, the tapering tail — see [`../specs/assets.md`](../specs/assets.md))
and the real HUD, rather than a CSS approximation of them. The captured images are
committed under `screenshots/` and referenced from the manifest as `media` (served
as-is), because there is no longer a mockup for the harness to render at seed time.

The screenshots are still **rendered, not source**: what a run receives is the image,
seeded as a visual target alongside the seeded specs under [`../specs/`](../specs/).
The build they were captured from is never seeded into a run.

## Views

The `title` view is **variant-specific** — each variant's main menu lists its own
single mode — so it lives under `screenshots/<variant>/`. The `gameplay` and
`game-over` views are **common**: they look the same in every variant, and are
captured from the `base` build and seeded for all of them.

| View slug   | Image                            | Captured from | Scope       |
| ----------- | -------------------------------- | ------------- | ----------- |
| `title`     | `screenshots/base/title.png`     | `base` build  | Base only   |
| `gameplay`  | `screenshots/gameplay.png`       | `base` build  | common      |
| `game-over` | `screenshots/game-over.png`      | `base` build  | common      |

```text
reference/screenshots/base/title.png   # Base only — the CLASSIC / HOW TO PLAY menu
reference/screenshots/gameplay.png     # common — the coiled snake mid-combo, and the HUD
reference/screenshots/game-over.png    # common — the end panel over the finished board
```

Seeding is keyed by the view slug, so the path here is purely organizational:
whichever variant a run selects, its `title.png` is seeded as `reference/title.png`,
so the model always sees a single stable path.

- **`gameplay`** shows the intended in-play look: the snake rendered from its
  produced sprites — head, straight body, and corner sprites where it bends, so the
  body reads as a continuous turning coil — pixel-aligned on the crisp grid, the
  pellet on the board, and the HUD showing `SCORE`, `BEST`, the mode tag, and the
  combo multiplier with its draining window bar.
- **`game-over`** shows the real end panel (`GAME OVER`, the final score and `BEST`,
  and the `PLAY AGAIN` / `MENU` choices) over the board the round ended on.

The `maze` variant's `title` view is still the `menu-maze.html` mockup (rendered at
seed time); it will be captured from a Maze build alongside this set once Maze mode
exists in the game.

## Regenerating the screenshots

The images are a capture of a real build, so regenerate them whenever the game's
look changes:

1. Build the game (`npm ci && npm run build`), which emits a static site to `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1). The build exposes its live game as
   `window.__coil` (`{ sim, state() }`) for exactly this headless capture; it is
   inert during normal play. Seed `localStorage` with `coil.best` so `BEST` reads a
   plausible high score, and `coil.muted` so the capture is silent.
3. Drive each view through the real input path — `Sim.requestTurn`, the same call a
   key press makes — so growth, turning, and the combo behave exactly as in play:
   - **title** — capture on load, once the sprites have finished loading.
   - **gameplay** — press `Enter` (the `CLASSIC` menu item), then steer the snake to
     eat pellets (shortest path to the pellet, avoiding the body) until it has grown
     into a coil with several bends and the combo has climbed to a multiplier of at
     least `x3`; capture while the window bar still has some of its drain left to
     show.
   - **game-over** — from a gameplay frame, stop steering and let the snake run into
     a wall, so the panel shows a real final score; capture once the state is
     `gameover`.
4. Write the PNGs to the paths above, then screenshot the `#stage` canvas (not the
   page) so the image is exactly the `1280x720` logical stage.

Pellet placement is random, so no two captures are identical; any representative
frame that clearly shows the view is fine.
