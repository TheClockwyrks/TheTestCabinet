# Floe

## Overview

Floe is a single-screen arcade crossing game for the browser. A small tundra
critter crosses a frozen strait, from the near shore at the bottom to a row of safe
bays on the far shore at the top, hopping one tile at a time over lanes of sliding
ice hazards and then across open water on drifting ice floes. All the while a polar
bear is hunting it.

Floe's defining idea is the hunter. The bear is not a timer or a lane hazard. It is
a live predator that chases the critter across the whole board. It emerges at the
near shore, paths toward the critter, dodges the same sliding hazards the player
does, and swims out after the player across the water. Its one limit is speed: it
moves a touch slower than a cleanly-played critter, so steady, decisive hopping
stays ahead of it, while any hesitation, backtrack, boxing-in by a hazard, or fumbled
floe lets it close and catch you. There is no safe place to wait; the only safety is
a bay on the far shore.

Floe has its own name, look, arctic setting, and pursuing hunter. Do not reproduce
the assets, branding, characters, or exact design of any existing game.

## How the specification is organized

This specification is split across several files. Read all of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` (this file): goals, hard requirements, free choices, the
  coordinate system, the palette and type, and the visual design.
- `specs/playfield.md`: the geometry of the strait, the tile grid, the near shore,
  the ice band, the median shelf, the water band, the far shore and its bays, and
  the HUD layout.
- `specs/hunter.md`: the signature system, the bear, how it pursues, and how it
  navigates hazards and water. Read this carefully.
- `specs/hazards.md`: the ice band, the sliding vehicles, their lanes and speeds,
  and how they kill.
- `specs/water.md`: the water band, the drifting floes, riding and drifting with
  them, drowning and off-edge death, and reaching the far-shore bays.
- `specs/controls.md`: the keyboard controls, the one-tile hop, and pause.
- `specs/flow.md`: the playable mode, scoring, lives, the timer, the level
  progression and victory, the game states, the HUD, audio, and the simulation
  model.
- `specs/assets.md`: the provided sprite art you render the game with, how it is
  organized, and the rule for loading it so the build works at any base path.
- `specs/instrumentation.md`: the `window.__floe` debugging and automation API, the
  debug overlay, and the deterministic, steppable core they rest on.

## Goal of this build

Produce a complete, polished, playable game that runs entirely in a browser. This
is a substantial front-end task: real-time rendered graphics, a fixed-step
simulation, tile-based hopping, lanes of sliding hazards and drifting floes with a
carry and drift model, a pursuing hunter with real pathfinding across the hazard
board and the water, a row of goal bays to fill, a timer, lives, a level
progression with a win and a loss, multiple game states and menus, and a HUD. Aim
for a build a person would actually want to play, tense and readable, not a tech
demo.

### Hard requirements

- Renders real graphics. Draw the game with Canvas 2D, WebGL/WebGPU, or positioned
  DOM elements, using the provided sprite assets (`specs/assets.md`). A text-only or
  ASCII rendering does not satisfy this requirement.
- Runs in the browser with no backend. No server, accounts, database, or network
  calls at runtime. Everything needed to play is self-contained.
- No API keys or credentials of any kind to build, run, or play.
- npm-driven static build. The project is a Node project with a `package.json` at
  its root, buildable with only Node.js and npm-installed dependencies and no
  separately installed language toolchain. Commit a `package-lock.json`, since the
  build is installed with `npm ci`. Running `npm ci` and then `npm run build`
  produces the complete static site, with no further manual step, into one of
  `dist/`, `build/`, or `out/` at the project root, with an `index.html` at the root
  of that directory as the entry point. That output directory runs correctly when
  served as-is from any static file server, at any base path (see `specs/assets.md`,
  because the game loads the seeded sprite art at runtime). You choose the language,
  framework, bundler, and rendering approach behind this interface; only the
  `npm ci` and `npm run build` commands and where the build output lands are fixed.
- Documentation. Include a `README.md` in the produced repository explaining what
  the game is, how to install dependencies, how to run it in development, how to
  produce the static production build, and the controls.
- Expose the `window.__floe` API and the read-only debug overlay described in
  `specs/instrumentation.md`, backed by the deterministic, steppable core the
  simulation model in `specs/flow.md` requires. This is a required part of the
  build.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to the
requirements above. Plain TypeScript with Canvas 2D is entirely sufficient; a
framework is not required. Favor a clean, well-structured codebase over any
particular technology.

The gameplay parameters are not among these free choices. The lane speeds, the
vehicles' and floes' directions, sizes, and spacing, the spawn model, the bear's
speed, and the per-level pacing are all fixed and given explicitly in
`specs/hazards.md`, `specs/water.md`, `specs/hunter.md`, and `specs/flow.md`.
Implement them exactly as written.

## Coordinate system and presentation

All positions, sizes, speeds, and ranges in this document are given in logical
pixels on a fixed 1280 x 720 stage (16:9). The origin `(0, 0)` is the top-left; `x`
increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game stays correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- The whole stage is on screen at every window size: the complete `1280 x 720` area
  is visible at once, including the full HUD bar, the entire strait from near shore
  to far bays, and all four edges, fitted to the window and centered with nothing
  clipped or pushed past the edges. The build fits correctly on load, before any
  input, and at any pixel density.

The stage is divided into the HUD bar across the top (`x` in `[0, 1280]`, `y` in
`[0, 80]`) and the strait below it (`x` in `[0, 1280]`, `y` in `[80, 720]`, so
1280 x 640). The strait is laid out on a tile grid: tiles are 32 x 32 logical
pixels, and the grid is 40 columns x 20 rows (1280 x 640). Column `c` (`0..39`)
spans `x` in `[32c, 32c + 32]`; row `r` (`0..19`) spans `y` in
`[80 + 32r, 80 + 32r + 32]`. Row 0 is the top (the far shore) and row 19 is the
bottom (the near shore); the critter crosses from row 19 up toward row 0. The
critter, the bear, the hazards, and the floes are each about one tile, and the
sprite art is authored at this 32 x 32 tile size (`specs/assets.md`). The full band
layout is defined in `specs/playfield.md`.

## Visual design

The look is a cold arctic strait at dusk: dark, deadly water; pale drifting ice;
and the action lit by the contrast between the small warm critter, the big white
bear, and the cold field. The canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Sea / deadly water | `#0a2233` |
| Sea, deep shadow | `#061a28` |
| Grid lines (on water) | `#123a4e` |
| Ice, shore / surface (bright) | `#dfeef5` |
| Median shelf (bright) | `#cfe6f2` |
| Ice band, the road (darker, duller) | `#9fb9c7` |
| Floe, pale ice (small pan) | `#c3dee9` |
| Ice edge / grid (on ice) | `#8fb6c9` |
| Goal bay, open (inviting glow) | `#ffd27f` |
| Crosser, warm fur | `#f2a03a` |
| Crosser, cream | `#ffe0a8` |
| Bear, fur | `#eef1ef` |
| Bear, cool shadow | `#aebfc7` |
| Bear, outline / eyes / nose | `#26323a` |
| Bear, submerged silhouette | `#5b6f7a` |
| Bear, wake / ripple | `#cfe6f2` |
| Plow / vehicle, steel | `#4a5560` |
| Car, body (sedan red) | `#b5423a` |
| Hazard yellow | `#ffd23f` |
| Splash / spray | `#cfe6f2` |
| Score / readouts | `#7fe0d0` |
| Warning / danger | `#e0492f` |
| Primary text | `#eaf4f8` |
| Secondary text | `#8fb6c9` |
| Tertiary text / hints | `#4d7488` |

- Use a monospace type family for all text (title, menus, HUD, labels). Do not
  depend on a web font that must be downloaded; use a system monospace stack so the
  game renders identically offline.
- The bands read clearly apart. The shores and the median shelf are bright pale
  ice; the ice band (the road) is a darker, duller ice so the median reads clearly
  as a distinct safe strip between the darker road and the dark water; the water
  band is dark deadly sea; and the bays glow warm and inviting at the top. A faint
  tile grid is visible so the player can read the lanes.
- Draw the bear and the critter from their provided frames (`specs/assets.md`),
  using the correct frame for the bear's current state: the run frame while it is on
  ice or a floe and the submerged swim frame while it is on the water
  (`specs/hunter.md`).
- The three canonical screens (the title screen, the in-game view, and the
  game-over screen) are described in full under Game states in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png`: the title screen and main menu.
- `reference/gameplay.png`: a representative in-game frame, mid-crossing.
- `reference/game-over.png`: the game-over screen.

Treat them as illustrative examples, not targets to reproduce: they show one way
the screens can look, but design your own menus and layout rather than copy them.
The only firm requirement is that every menu and navigation path this specification
mandates is present, rendered in the palette and type the spec defines. They are
images only, and the hazards, floes, bear, and critter positions they show are just
one example moment. The lanes are populated at runtime and the bear pursues live,
so build the screens from this specification rather than copying a frame.
