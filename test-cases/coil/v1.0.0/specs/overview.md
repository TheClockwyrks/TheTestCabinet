# Coil

## Overview

**Coil** is a neon, grid-locked serpent game for the browser. A snake threads a
single continuous path across a bordered grid, eating pellets that make it grow
one cell longer each time. The longer it gets, the less room there is to move,
until a single wrong turn runs the snake into a wall or into its own body and
the round ends.

Coil is a game of momentum and route-planning. Its defining mechanic is the
**combo**: pellets eaten in quick succession build a scoring multiplier that
decays the moment you dawdle, so a strong player is the one who plans an
efficient path from one pellet to the next, not just the one who survives.

Coil is inspired by classic grid-and-growth arcade games but is its own game,
with an original name, look, and combo mechanic. Do not reproduce the assets,
branding, or exact design of any existing game.

## How the specification is organized

This specification is split across several files:

- `specs/overview.md` — this file: the overview, goals, hard requirements, free
  choices, coordinate system, and visual design.
- `specs/playfield.md` — the grid, walls, cells, pellets, and how the board is
  laid out and rendered.
- `specs/mechanics.md` — the game tick, movement, turning, growth, collision,
  and the combo mechanic.
- `specs/flow.md` — scoring, game states, controls, audio, the HUD, key
  behaviors, and what is out of scope.
- the mode specs under `specs/modes/` — the playable game modes. Each mode spec
  defines one mode and the main-menu entry for it.

Read every spec file, including each mode spec under `specs/modes/`, and
implement the modes they define. The main menu lists those modes, then `HOW TO
PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: real-time rendered graphics, a
fixed-timestep game loop, grid-locked movement and collision, a scoring system
with a decaying combo, multiple game states and menus, and persistent
high-score tracking. Aim for a build a person would actually enjoy playing, not
a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this
  requirement.
- **Runs in the browser with no backend.** No server, accounts, database, or
  network calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a
  `package.json` at its root, buildable with **only Node.js and npm-installed
  dependencies** (no separately installed language toolchain). **Commit a
  `package-lock.json`**: the build is installed with `npm ci`, which requires that
  lockfile. Running `npm ci` and then `npm run build` must produce the complete
  static site, with no further manual step, into one of `dist/`, `build/`, or
  `out/` at the project root, with an `index.html` at the root of that directory
  as the entry point. That output directory must run correctly when served as-is
  at the root of any static file server, since it is deployed to static hosting
  exactly that way. You choose the language, framework, bundler, and rendering
  approach behind this interface; only the `npm ci` and `npm run build` commands
  and where the build output lands are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above — including the npm-driven static build, which fixes the
`npm ci` and `npm run build` commands and where the output lands, but not how you
implement the build behind them. Plain TypeScript with Canvas 2D is entirely
sufficient; a framework is not required. Favor a clean, well-structured codebase
over any particular technology.

## Coordinate system and presentation

The game is laid out on a fixed **1280 x 720** logical stage (16:9). The origin
`(0, 0)` is the **top-left**; `x` increases to the right and `y` increases
downward. All positions and sizes in this specification are given in **logical
pixels** on that stage.

The play area is a grid of square cells. The grid and its placement on the stage
are defined precisely in `specs/playfield.md`; everything else is positioned
relative to it. Two coordinate references are used throughout:

- **Cell coordinates** `(col, row)` — integer grid indices used by the
  simulation (the snake, pellets, and collisions live on this grid).
- **Logical pixels** — the `1280 x 720` stage, used for rendering and for the
  HUD layout.

Presentation requirements:

- The 1280 x 720 stage scales uniformly to fit the browser window while
  preserving its 16:9 aspect ratio, letterboxed with the background color on the
  remaining space. The game must remain correct and centered at any window size.
- Simulation logic operates in cell coordinates, independent of the rendered
  scale. Rendering maps cells to logical pixels and then to screen pixels.
- **The whole stage must be on screen.** At every window size the complete
  `1280 x 720` stage is visible at once — the entire board, every wall, the full
  HUD, and every menu item — fitted to the window and centered, with nothing
  clipped or pushed past the edges. The build must fit correctly on load, before
  any input, and at any pixel density.
- Cells render as crisp squares. Do not blur or smooth the grid; the look is
  sharp and blocky, not anti-aliased into softness.

## Visual design

The look is neon-on-charcoal. The canonical palette and type are defined below;
match them.

| Element                | Color     |
| ---------------------- | --------- |
| Stage background       | `#0b0e14` |
| Board interior         | `#0f1420` |
| Board grid lines       | `#161c28` |
| Wall border            | `#2a3550` |
| Snake head             | `#5ef38c` |
| Snake body             | `#2fd07a` |
| Pellet                 | `#ff5c8a` |
| Bonus orb              | `#ffd23f` |
| Maze obstacle          | `#ffb454` |
| Combo accent           | `#ffd23f` |
| Primary text           | `#e6edf3` |
| Secondary text         | `#8a94a6` |
| Faint text / hints     | `#4a5567` |

- Use a **monospace** type family for all text (scores, menus, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is
  required so the game renders identically offline.
- The snake, pellets, bonus orbs, and obstacles have a soft neon glow. The board
  interior is faintly gridded with the grid-line color so individual cells read
  without dominating the field.
- The snake's **head** is drawn in the brighter head color and its **body**
  segments in the dimmer body color, so the leading cell is always
  distinguishable from the trail.
- The canonical screens — the title screen, the in-game view, and the game-over
  screen — are described in full under Game States in `specs/flow.md`. Implement
  each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-game frame.
- `reference/game-over.png` — the game-over screen.

Treat them as **illustrative examples, not targets to reproduce**: they show
one way the screens can look, but design your own menus and layout rather than
copy them. The only firm requirement is that every menu and navigation path
this specification mandates is present, rendered in the palette and type the
spec defines. They are images only — build the screens from this specification.
