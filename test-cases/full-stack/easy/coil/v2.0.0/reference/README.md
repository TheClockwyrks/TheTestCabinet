# Coil — Reference Visuals

These images are the **canonical visual reference** for the Coil test case. Each is
a `1280x720` screenshot captured from a **playable Coil build** — the real game,
driven with Playwright — not from a hand-authored mockup. They serve two purposes:
they are seeded into a run as visual targets, and they are the baselines for any
validation check (declared in `../test-case.toml`) that names the view.

## The playable build is the source of truth

Coil's reference screenshots are **derived from real games**. There is no separate
HTML/CSS mockup to keep in sync (the former `*.html` + `theme.css` mockups were
removed): a playable build per variant *is* the ground truth, and the screenshots
are captured straight from it — so each image shows the actual produced sprite set
(the biting head, the straight-body tube, the corner sprites at each bend, the
tapering tail — see [`../specs/assets.md`](../specs/assets.md)) and the real board
and HUD, rather than a CSS approximation of them. The captured images are committed
under `screenshots/` and referenced from the manifest as `media` (served as-is),
because there is no longer a mockup for the harness to render at seed time.

The screenshots are still **rendered, not source**: what a run receives is the image,
seeded as a visual target alongside the seeded specs under [`../specs/`](../specs/).
The builds they were captured from are never seeded into a run.

## Views

There are **no common views**. Every view is variant-specific and lives under
`screenshots/<variant>/`, because each variant is exactly one mode and the mode shows
in all three:

- the **title** menu lists that variant's single mode (`CLASSIC` for `base`, `MAZE`
  for `maze`, each above `HOW TO PLAY`);
- the **gameplay** board differs by mode — Maze laces the board with the fixed, fatal
  obstacle course (see [`../specs/gameplay.md`](../specs/gameplay.md)) that a
  Classic board does not have; and
- the **game-over** frame shows the dimmed board behind the end panel — obstacle bars
  included — and the HUD's mode tag, so it too differs by mode.

| View slug   | Base                            | Maze                            |
| ----------- | ------------------------------- | ------------------------------- |
| `title`     | `screenshots/base/title.png`    | `screenshots/maze/title.png`    |
| `gameplay`  | `screenshots/base/gameplay.png` | `screenshots/maze/gameplay.png` |
| `game-over` | `screenshots/base/game-over.png`| `screenshots/maze/game-over.png`|

```text
base/title.png       # the CLASSIC / HOW TO PLAY menu
base/gameplay.png    # the coiled snake mid-combo on the open board
base/game-over.png   # the end panel over the open board
maze/title.png       # the MAZE menu, obstacle course dimmed behind it
maze/gameplay.png    # the snake threading the fatal obstacle bars
maze/game-over.png   # the end panel, bars still visible behind it
```

Seeding is keyed by the view slug, so the path here is purely organizational:
whichever variant a run selects, its images are seeded as `reference/title.png`,
`reference/gameplay.png`, and `reference/game-over.png`, so the model always sees a
single stable set of paths.

- **`gameplay`** shows the intended in-play look: the snake rendered from its
  produced sprites — head, straight body, and corner sprites where it bends, so the
  body reads as a continuous turning coil — pixel-aligned on the crisp grid, the
  pellet on the board, and the HUD showing `SCORE`, `BEST`, the mode tag, and the
  combo multiplier with its draining window bar. The Maze capture additionally shows
  the four obstacle bars in the obstacle color, point-symmetric about the board
  centre.
- **`game-over`** shows the real end panel (`GAME OVER`, the final score and `BEST`,
  and the `PLAY AGAIN` / `MENU` choices) over the board the round ended on.

## Regenerating the screenshots

The images are a capture of real builds, so regenerate them whenever a build's look
changes. A build implements exactly one mode (the one its seeded `specs/gameplay.md`
describes), so the Base views come from a Classic build and the Maze views from a
Maze build:

1. Build the game (`npm ci && npm run build`), which emits a static site to `dist/`.
2. Serve the built `dist/` over HTTP and open it in Playwright Chromium at a
   `1280x720` viewport (device scale factor 1). The build exposes its live game as
   `window.__coil` (`{ sim, state() }`) for exactly this headless capture; it is
   inert during normal play. Seed `localStorage` with `coil.best` so `BEST` reads a
   plausible high score, and `coil.muted` so the capture is silent.
3. Drive each view through the real input path — `Sim.requestTurn`, the same call a
   key press makes — so growth, turning, and the combo behave exactly as in play:
   - **title** — capture on load, once the sprites have finished loading.
   - **gameplay** — press `Enter` (the mode's menu item), then steer the snake to eat
     pellets (shortest path to the pellet, treating the body **and, in Maze, the
     obstacle cells** as solid) until it has grown into a coil with several bends and
     the combo has climbed to a multiplier of at least `x3`; capture while the window
     bar still has some of its drain left to show.
   - **game-over** — from a gameplay frame, stop steering and let the snake run into
     a wall, so the panel shows a real final score; capture once the state is
     `gameover`.
4. Screenshot the `#stage` canvas (not the page), so the image is exactly the
   `1280x720` logical stage, and write the PNGs to the paths above.

Pellet placement is random, so no two captures are identical; any representative
frame that clearly shows the view is fine.
