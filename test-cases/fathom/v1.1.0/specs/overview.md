# Fathom

## Overview

**Fathom** is a bioluminescent deep-sea maze chase for the browser. You are a
small glowing forager threading the flooded corridors of a pitch-dark trench,
grazing drifting **plankton** while three very different predators hunt you. The
trench is dark: you only know what your own light has touched or what a **sonar**
pulse has revealed, so the game is as much about *sensing* where the danger is as
about outrunning it.

Fathom's defining idea is **hunting in the dark**. The maze begins unseen and is
uncovered as you explore or ping it; the predators stay hidden between glimpses;
and each predator hunts by a different sense — one tracks your **light**, one
tracks **sound**, one hunts only in the flash of its own **flare**. Skilled play
is about controlling what you reveal and reading the faint tells each predator
gives off, not just memorizing a route.

Fathom is inspired by classic maze-chase arcade games but is its own game, with
an original name, look, fog-of-war sensing, and predators. Do not reproduce the
assets, branding, characters, or exact design of any existing game.

## How the specification is organized

This specification is split across several files. Read **all** of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, and how the dark trench is drawn.
- `specs/playfield.md` — the maze geometry, the den, the wrap tunnels, plankton,
  the bonus drifter, and the HUD layout.
- `specs/sensing.md` — the signature systems: how the dark trench is read — your
  light, the sonar pulse, and your brightness. **Read this carefully.**
- `specs/movement.md` — tile-based movement, the controls, and the ink defense.
- `specs/predators.md` — the three predators, the den release schedule, and how
  each one senses and hunts you.
- `specs/flow.md` — scoring, lives, descending to deeper trenches, the game
  states, the HUD, audio, and what is out of scope.
- `specs/assets.md` — the **provided art assets** (seeded under `assets/`) you
  must render the game with: the forager, predators, flare bloom, and trench tiles,
  their frame layouts, and what is left to draw in code (including the sonar pulse).

The main menu is a single dive — it lists `DIVE` (begin a dive), then
`HOW TO PLAY` (see Game states in `specs/flow.md`).

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: real-time rendered graphics, a fixed-step
simulation, a fog-of-war visibility system, tile-locked maze movement, three
distinct predator behaviors, multiple game states and menus, and a HUD. Aim for
a build a person would actually want to play — tense and readable — not a tech
demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this
  test case.
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
  from a static file server **at any base path, not only the server root** — when
  it is played back it is mounted under a per-run sub-path (a path like
  `/runs/<id>/build/`), so every URL the build requests must resolve relative to
  the page rather than the origin root. `specs/assets.md` states the loading rule
  in full (no root-absolute `/…` URLs; a relative bundler base such as Vite's
  `base: './'`); it governs the art assets and the bundled JS/CSS alike. You
  choose the language, framework, bundler, and rendering approach behind this
  interface; only the `npm ci` and `npm run build` commands and where the build
  output lands are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above — including the npm-driven static build, which fixes the
`npm ci` and `npm run build` commands and where the output lands, but not how you
implement the build behind them. Plain TypeScript with Canvas 2D is entirely
sufficient; a framework is not required. Favor a clean, well-structured codebase
over any particular technology. **You design the maze layout** (within the
constraints in `specs/playfield.md`) — there is no fixed maze to reproduce.

## Coordinate system and presentation

All positions, sizes, speeds, and ranges in this document are given in **logical
pixels** on a fixed **1280 x 720** stage (16:9). The origin `(0, 0)` is the
**top-left**; `x` increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete
  `1280 x 720` area is visible at once — the entire maze region, the full HUD, and
  all four edges — fitted to the window and centered, with nothing clipped or
  pushed past the edges. The build must fit correctly on load, before any input,
  and at any pixel density.

The maze is laid out on a **tile grid**: tiles are **32 x 32** logical pixels.
The grid is **36 columns x 18 rows** (`1152 x 576`), with its top-left tile
corner at **`(64, 80)`**, so the maze region spans `x` in `[64, 1216]` and `y` in
`[80, 656]`. Column `c` (`0..35`) spans `x` in `[64 + 32c, 96 + 32c]`; row `r`
(`0..17`) spans `y` in `[80 + 32r, 112 + 32r]`. The **HUD** occupies the top
strip `y` in `[0, 80]` and the bottom strip `y` in `[656, 720]`. Tile centers are
the reference points for movement and sensing throughout this spec.

## Visual design

The look is **bioluminescence in the abyss**: cold light glowing out of a
near-black trench. The canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Trench background / unrevealed fog | `#03060c` |
| Revealed open water (corridor floor) | `#0a1422` |
| Revealed wall (rock) | `#16293d` |
| Wall edge / rim light | `#24506b` |
| Player forager and its light | `#46f0e0` |
| Plankton | `#b8f5c8` |
| Sonar pulse (forager's ping) | `#5ef2ff` |
| The Lanternjaw (light-seeker) and its bulb | `#ffd166` |
| The bonus drifter | `#ffd166` |
| The Gloamfin (sound-seeker) | `#c46bff` |
| The Flarefish (flare-maker) | `#ff7a59` |
| Ink cloud | `#0b0a1f` |
| Primary text | `#e6edf3` |
| Secondary text | `#8a94a6` |

- **The art is provided — use it.** The forager, the three predators, the flare
  bloom, and the trench tiles (walls, floor, fog, den gate) are delivered as seeded
  sprite-sheet assets under `assets/`, already drawn in this palette. Render the game
  with them rather than drawing your own; their frame layouts and compositing are
  defined in `specs/assets.md`. The palette below still governs everything you *do*
  draw in code (the sonar pulse, plankton, the bonus drifter, ink, the forager's
  glow, the HUD, and all text).
- Use a **monospace** type family for all text (title, menus, HUD, labels). Do
  not depend on a web font that must be downloaded; a system monospace stack is
  required so the game renders identically offline.
- Against the dark water, plankton, the forager's light, and the predators' tells
  read as soft neon glows; the provided creature sprites carry the art, while the
  forager's brightness glow and lit pocket are runtime light you draw around the
  sprite (see `specs/sensing.md` and `specs/assets.md`). Walls read as solid dark
  rock with a faint rim light along their edges — drawn from the trench tileset.
- **The trench is dark (required, and central to the game).** Tiles that have
  never been touched by your light, a sonar pulse, or a flare are drawn as
  unrevealed fog (`#03060c`) — indistinguishable black, hiding whether they are
  wall or open water. How tiles become and stay revealed, and how the predators
  and plankton appear within them, is defined in full in `specs/sensing.md`. The
  in-match view in `reference/gameplay.png` shows the intended look: a lit pocket
  of revealed maze around the forager, fading into black, with predators visible
  only where light or sonar reaches.
- The three canonical screens — the title screen, the in-match view, and the
  game-over screen — are described in full under Game states in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-match frame, mid-dark.
- `reference/game-over.png` — the game-over screen.

Treat them as **illustrative examples, not targets to reproduce**: they show
one way the screens can look, but design your own menus and layout rather than
copy them. The only firm requirement is that every menu and navigation path
this specification mandates is present, rendered in the palette and type the
spec defines. They show the **provided assets** (`specs/assets.md`) in place —
the forager, predators, effects, and trench tiles you build with — so use them
to gauge how those assets sit in the scene. They are images only, and the maze
they show is just **one example layout**: build the screens from this
specification, and design your own conforming maze.
