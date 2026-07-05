# Floe

## Overview

**Floe** is a single-screen arcade **crossing** game for the browser. A small
tundra critter must cross a frozen strait — from the near shore at the bottom to
a
row of safe **bays** on the far shore at the top — hopping one tile at a time over
lanes of sliding **ice hazards** and then across open water on drifting **ice
floes**. All the while a **polar bear** is hunting it.

Floe's defining idea is the **hunter**. The bear is not a timer or a lane hazard
—
it is a live predator that **chases the critter across the whole board**. It
emerges at the near shore, paths toward the critter, dodges the same sliding
hazards the player does, and swims out after the player across the water. Its one
limit is speed: it moves a touch slower than a cleanly-played critter, so steady,
decisive hopping stays ahead of it — but **hesitate, backtrack, get boxed in by
a
hazard, or fumble a floe and it closes and catches you**. There is no safe place
to
wait; the only safety is a bay on the far shore.

Floe is inspired by classic single-screen crossing games but is its own game, with
an original name, look, the pursuing hunter, and its own arctic setting. Do not
reproduce the assets, branding, characters, or exact design of any existing game.

## How the specification is organized

This specification is split across several files. Read **all** of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, and the visual design.
- `specs/playfield.md` — the geometry of the strait: the tile grid, the near
  shore, the ice band, the median shelf, the water band, the far shore and its
  bays, and the HUD layout.
- `specs/hunter.md` — the signature system: the bear, how it pursues, how it
  navigates hazards and water, and how it stays readable. **Read this carefully.**
- `specs/hazards.md` — the ice band: the sliding hazards (the crawler and the
  berg), their lanes and speeds, and how they kill.
- `specs/water.md` — the water band: the drifting floes, riding and drifting with
  them, drowning and off-edge death, and reaching the far-shore bays.
- `specs/controls.md` — the keyboard controls: the one-tile hop, and pause.
- `specs/flow.md` — scoring, lives, the timer, the level progression and victory,
  the game states, the HUD, audio, and what is out of scope.
- `specs/assets.md` — the provided sprite art you must render the game with, how
  it is organized, and the rule for loading it so the build works at any base path.
- the mode specs under `specs/modes/` — the playable mode(s) and the main-menu
  entry for each. Read every mode spec present and implement the modes they define.
  The main menu lists those modes, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: real-time rendered graphics, a fixed-step
simulation, tile-based hopping, lanes of sliding hazards and drifting floes with
a
carry/drift model, a **pursuing hunter with real pathfinding** across the hazard
board and the water, a row of goal bays to fill, a timer, lives, a level
progression with a win and a loss, multiple game states and menus, and a HUD. Aim
for a build a person would actually want to play — tense and readable — not a tech
demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements, using the provided sprite assets (`specs/assets.md`).
  A
  text-only or ASCII rendering does not satisfy this test case.
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
  as
  the entry point. That output directory must run correctly when served as-is from
  any static file server, **at any base path** — see `specs/assets.md`, because
  the
  game loads the seeded sprite art at runtime. You choose the language, framework,
  bundler, and rendering approach behind this interface; only the `npm ci` and
  `npm run build` commands and where the build output lands are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development, how
  to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the
requirements above. Plain TypeScript with Canvas 2D is entirely sufficient; a
framework is not required. Favor a clean, well-structured codebase over any
particular technology. **You design the exact lane speeds, spawn timing, floe
sizes and spacing, and per-level pacing** within the constraints in
`specs/hazards.md`, `specs/water.md`, `specs/hunter.md`, and `specs/flow.md`.

## Coordinate system and presentation

All positions, sizes, speeds, and ranges in this document are given in **logical
pixels** on a fixed 1280 x 720 stage (16:9). The origin `(0, 0)` is the top-left;
`x` increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete `1280
  x
  720` area is visible at once — the full HUD bar, the entire strait from near shore
  to far bays, and all four edges — fitted to the window and centered, with nothing
  clipped or pushed past the edges. The build must fit correctly on load, before
  any input, and at any pixel density.

The stage is divided into the **HUD bar** across the top — `x` in `[0, 1280]`, `y`
in `[0, 80]` — and the **strait** below it — `x` in `[0, 1280]`, `y` in `[80, 720]`
(1280 x 640). The strait is laid out on a **tile grid**: tiles are **32 x 32**
logical pixels, and the grid is **40 columns x 20 rows** (`1280 x 640`). Column
`c`
(`0..39`) spans `x` in `[32c, 32c + 32]`; row `r` (`0..19`) spans `y` in `[80 +
32r, 80 + 32r + 32]`. **Row 0 is the top** (the far shore) and **row 19 is the
bottom** (the near shore); the critter crosses from row 19 up toward row 0. The
critter, the bear, the hazards, and the floes are each about one tile, and the
sprite art is authored at this `32 x 32` tile size (`specs/assets.md`). The full
band layout is defined in `specs/playfield.md`.

## Visual design

The look is a cold arctic strait at dusk: dark, deadly water; pale drifting ice;
and the action lit by the contrast between the small **warm** critter, the big
**white** bear, and the cold field. The canonical palette and type are below;
match them.

| Element | Color |
| --- | --- |
| Sea / deadly water | `#0a2233` |
| Sea — deep shadow | `#061a28` |
| Grid lines (on water) | `#123a4e` |
| Ice — shore / surface | `#dfeef5` |
| Ice — pale blue | `#c3dee9` |
| Ice edge / grid (on ice) | `#8fb6c9` |
| Median shelf | `#cfe6f2` |
| Goal bay — open (inviting glow) | `#ffd27f` |
| Crosser — warm fur | `#f2a03a` |
| Crosser — cream | `#ffe0a8` |
| Bear — fur | `#eef1ef` |
| Bear — cool shadow | `#aebfc7` |
| Bear — outline / eyes / nose | `#26323a` |
| Bear — submerged silhouette | `#5b6f7a` |
| Bear — wake / ripple | `#cfe6f2` |
| Crawler — steel | `#4a5560` |
| Hazard yellow | `#ffd23f` |
| Berg — ice | `#9cc0d6` |
| Splash / spray | `#cfe6f2` |
| Score / readouts | `#7fe0d0` |
| Warning / danger | `#e0492f` |
| Primary text | `#eaf4f8` |
| Secondary text | `#8fb6c9` |
| Tertiary text / hints | `#4d7488` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is required
  so the game renders identically offline.
- The bands read clearly apart: the **shores, median, and ice band** are pale ice;
  the **water band** is dark deadly sea; the **bays** glow warm and inviting at
  the
  top. A faint tile grid is visible so the player can read the lanes.
- **The bear must always be readable.** It is a big white animal on pale ice, so
  render it with its dark outline (`specs/assets.md`) so it never disappears against
  the ice — and when it swims it must still be trackable as a silhouette and wake
  on the water (`specs/hunter.md`). Keep the **warm critter** and the **white
  bear** visually unmistakable from each other and from the field.
- The three canonical screens — the title screen, the in-game view, and the
  game-over screen — are described in full under Game states in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-game frame, mid-crossing.
- `reference/game-over.png` — the game-over screen.

Treat them as visual targets: match their layout, palette, and type. They are
images only — and the hazards, floes, bear, and critter positions they show are
just **one example moment**. Build the screens from this specification; the lanes
are populated at runtime and the bear pursues live, so design your own conforming
game, not a copy of the frame.
