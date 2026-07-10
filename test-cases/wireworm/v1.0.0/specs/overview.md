# Wireworm

## Overview

**Wireworm** is a fixed-shooter arcade game for the browser. A segmented
**data-worm** winds down a circuit board through a field of **capacitor nodes**;
you are a **defrag cursor** pinned to a shallow band at the bottom, firing
**upward** to cut the worm apart before it reaches you.

Wireworm's defining idea is the **charged field**. Every node the worm bumps
gains **charge** — the same collision that steers the worm energizes the terrain
it steers on. A fully-charged node is a weapon: shoot it and it **detonates**,
arcing through the whole charged cluster around it, clearing those nodes and
**cleanly frying** any worm segments caught in the arc. But the board fights back:
every worm segment you shoot leaves a fresh node behind, so the field thickens as
you fight, and a thicker field drives the worm **down** at you faster. The game
is the tug between those two — let the field build and charge so you can clear it
in one great discharge, but not so far that the worm rides it into your band.

Wireworm is inspired by classic fixed-shooter "field of obstacles" arcade games
but is its own game, with an original name, look, the charged-node discharge, and
its own data-worm. Do not reproduce the assets, branding, characters, or exact
design of any existing game.

## How the specification is organized

This specification is split across several files. Read **all** of them before
you start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, and the visual design.
- `specs/playfield.md` — the geometry of the board: the tile grid, the node
  field, the player band, where the worm enters, and the HUD layout.
- `specs/charge.md` — the signature systems: node charge, how the worm charges
  the field, what your shots do to a node, and the chain-arc discharge. **Read
  this carefully.**
- `specs/worm.md` — the data-worm: how it is built from segments, how it winds
  down the board, how splitting and shortening work, and how it grows the field.
- `specs/foes.md` — the support foes (the glitch, the packet-dropper, and the
  corruptor), their behavior, and how they threaten you and reshape the field.
- `specs/controls.md` — the keyboard (and optional mouse) controls: moving in the
  band, firing, and pause.
- `specs/flow.md` — scoring, lives, the level progression and victory, the game
  states, the HUD, audio, and what is out of scope.
- `specs/assets.md` — the provided sprite art you must render the game with, how
  it is organized, and the rule for loading it so the build works at any base path.
- the `standard` spec — the playable mode and its main-menu entry. The main menu
  lists that mode, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: real-time rendered graphics, a fixed-step
simulation, a segmented worm that winds a tile field and splits when shot, a
charged-terrain model with a chain-reaction discharge, three distinct support
foes, a shot/collision system, a field that persists and thickens across a level
run, multiple game states and menus, and a HUD. Aim for a build a person would
actually want to play — tense and readable — not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements, using the provided sprite assets (`specs/assets.md`).
  A text-only or ASCII rendering does not satisfy this test case.
- **Runs in the browser with no backend.** No server, accounts, database, or
  network calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a
  `package.json` at its root, buildable with **only Node.js and npm-installed
  dependencies** (no separately installed language toolchain). **Commit a
  `package-lock.json`**: the build is installed with `npm ci`, which requires
  that lockfile. Running `npm ci` and then `npm run build` must produce the
  complete static site, with no further manual step, into one of `dist/`,
  `build/`, or `out/` at the project root, with an `index.html` at the root of
  that directory as the entry point. That output directory must run correctly
  when served as-is from any static file server, **at any base path** — see
  `specs/assets.md`, because the game loads the seeded sprite art at runtime.
  You choose the language, framework, bundler, and rendering approach behind this
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
over any particular technology. **You design the exact spawn timing, level pacing,
and per-level composition** of the worm and foes within the constraints in
`specs/worm.md`, `specs/foes.md`, and `specs/flow.md`.

## Coordinate system and presentation

All positions, sizes, speeds, and ranges in this document are given in **logical
pixels** on a fixed 1280 x 720 stage (16:9). The origin `(0, 0)` is the top-left;
`x` increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete `1280
  x 720` area is visible at once — the full HUD bar, the entire board, and all
  four edges — fitted to the window and centered, with nothing clipped or pushed
  past the edges. The build must fit correctly on load, before any input, and at
  any pixel density.

The stage is divided into the **HUD bar** across the top — `x` in `[0, 1280]`,
`y` in `[0, 80]` — and the **board** below it — `x` in `[0, 1280]`, `y` in `[80,
720]` (1280 x 640). The board is laid out on a **tile grid**: tiles are **32 x
32** logical pixels, and the grid is **40 columns x 20 rows** (`1280 x 640`).
Column `c` (`0..39`) spans `x` in `[32c, 32c + 32]`; row `r` (`0..19`) spans `y`
in `[80 + 32r, 80 + 32r + 32]`. A node fills exactly one tile, and each worm
segment occupies one tile; the sprite art is authored at this `32 x 32` tile size
(`specs/assets.md`). The grid geometry, the node field, the player band, and the
HUD are defined in full in `specs/playfield.md`.

## Visual design

The look is a dark circuit board lit by charge: a deep board with faint copper
traces, a field of little capacitor nodes that glow brighter as they charge,
and a
violet data-worm winding down through them. The canonical palette and type are
below; match them.

| Element | Color |
| --- | --- |
| Board / stage background | `#0b1418` |
| Trace grid lines | `#14282e` |
| Player-band tint (bottom rows) | `#0f1f1c` |
| HUD bar background | `#0c191c` |
| HUD edges / dividers | `#1c3a40` |
| Node casing | `#25303a` |
| Node metal rim / leads | `#5a7183` |
| Node core — inert (charge 0) | `#20343d` |
| Node charge — low (charge 1) | `#2f9e86` |
| Node charge — mid (charge 2) | `#54e6bd` |
| Node core — critical (charge 3) | `#e6fff7` |
| Node overcharge spark / corruption | `#ffb43a` |
| Discharge arc | `#b8ffe6` |
| Worm carapace | `#7a2fae` |
| Worm carapace edge | `#c06bff` |
| Worm data seam | `#ff3fa4` |
| Worm sensor eye | `#ff5a3c` |
| Player cursor chassis | `#3f8ba3` |
| Player cursor core / bolt | `#57e0ff` |
| Player cursor highlight | `#eafcff` |
| Glitch (node-eater) | `#d92b4a` |
| Packet-dropper | `#e8a83a` |
| Corruptor | `#8fd63a` |
| Score / readouts | `#54e6bd` |
| Primary text | `#dfeef0` |
| Secondary text | `#7f9aa0` |
| Tertiary text / hints | `#4a6068` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do
  not depend on a web font that must be downloaded; a system monospace stack is
  required so the game renders identically offline.
- The trace grid is faint but always visible on the board, so the player can read
  tiles and the shape of the node field. The bottom **player band**
  (`specs/playfield.md`) reads as subtly distinct — a faint tinted floor — so it
  is clear where the cursor may go.
- **Charge must be readable at a glance, and by more than motion alone.** A node's
  glow tracks its charge along the ramp above — inert dark → low teal →
  mid cyan →
  white-hot critical — and a **critical** node is unmistakable (the brightest,
  with amber overcharge sparks, visibly pulsing). Because charge is the heart of
  the game, a player must be able to tell a critical node ready to detonate
  from a
  half-charged one without guessing. Render the provided node sprite for each
  charge state (`specs/assets.md`).
- Keep the worm and the foes **off the node charge ramp** so they never read as
  "charge": the worm is violet with a magenta seam, the glitch error-red, the
  dropper amber, the corruptor toxic-green — never the teal→white of the node
  charge ramp. (The corruptor's amber stinger deliberately matches the node
  overcharge color, because charging nodes to critical is exactly what it does —
  `specs/foes.md`.)
- The three canonical screens — the title screen, the in-game view, and the
  game-over screen — are described in full under Game states in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-game frame, mid-level.
- `reference/game-over.png` — the game-over screen.

Treat them as **illustrative examples, not targets to reproduce**: they show one
way the screens can look, but design your own menus and layout rather than copy
them. The only firm requirement is that every menu and navigation path this
specification mandates is present, rendered in the palette and type the spec
defines. They are images only — and the node field, worm, and foes they show are
just **one example moment**. Build the screens from this specification; the field
is grown at runtime and is never fixed, so design your own conforming game, not a
copy of the frame.
