# Meltdown

## Overview

**Meltdown** is an open-field **tower-defense** game for the browser. Waves of
'surge' intruders pour in through the vents of a reactor floor and try to
reach the exhaust vents; you stop them by building **emitter towers** on the
open floor. Your towers are also **walls**, so you do not defend a fixed path —
you *build the maze* the surge must walk, winding it the long way around so your
emitters have time to burn it down.

Meltdown's defining idea is **heat as power**. Every emitter fires harder the
hotter it runs — its damage climbs the more it shoots — but push it past the
redline and it trips offline to cool, leaving a hole in your defense. So laying
out the floor is a thermal problem as much as a spatial one: you want your guns
hot, but not so hot they cut out. Two support structures let you sculpt that
heat — a **Forge** that pours heat into its neighbors and a **Sink** that draws
it away — and one emitter, the cryo **Rime**, runs the rule *backward*: it
slows the surge best when it stays cold. Skilled play is about pacing heat
across the floor — running a tight core white-hot, keeping a sniper fed,
holding the cryo line cold — not just walling a path.

Meltdown is inspired by classic open-field "maze" tower-defense games but is its
own game, with an original name, look, the heat-as-power emitters, and its own
surge. Do not reproduce the assets, branding, characters, or exact design of any
existing game.

## How the specification is organized

This specification is split across several files. Read **all** of them before
you start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, and the visual design.
- `specs/playfield.md` — the geometry of the reactor: the casing wall, the tile
  grid, the vents and exhausts, how towers wall the floor, how the surge paths
  through the maze, and the build-panel/HUD layout.
- `specs/heat.md` — the signature systems: heat as power, the heat-to-damage
  curve, the redline trip, thermal coupling between neighbors, and the three
  thermal stances. **Read this carefully.**
- `specs/towers.md` — the eight tower types (six emitters plus the Forge and
  Sink), their stats and thermal personalities, and how you build, upgrade, and
  sell them.
- `specs/creeps.md` — the surge: the intruder types, the flyers that ignore the
  maze, and how a wave is composed.
- `specs/controls.md` — the mouse and keyboard controls: placing, selecting,
  upgrading and selling towers, sending waves, game speed, and pause.
- `specs/flow.md` — the economy, lives, the wave progression and victory,
  scoring, the game states, the HUD, and what is out of scope.
- the `standard` spec — the playable mode and its main-menu entry. The main
  menu lists that mode, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: real-time rendered graphics, a fixed-step
simulation, grid-based tower placement with live maze re-pathing, eight tower
types each with a distinct thermal behavior, a heat-to-damage model with a
redline trip, upgrade and economy systems, several surge types including flyers,
a wave progression with a win and a loss, multiple game states and menus, and a
HUD. Aim for a build a person would actually want to play — tense and readable —
not a tech demo.

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
  `package-lock.json`**: the build is installed with `npm ci`, which requires
  that lockfile. Running `npm ci` and then `npm run build` must produce the
  complete static site, with no further manual step, into one of `dist/`,
  `build/`, or `out/` at the project root, with an `index.html` at the root of
  that directory as the entry point. That output directory must run correctly
  when served as-is at the root of any static file server, since it is deployed
  to static hosting exactly that way. You choose the language, framework,
  bundler, and rendering approach behind this interface; only the `npm ci` and
  `npm run build` commands and where the build output lands are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above — including the npm-driven static build, which fixes the
`npm ci` and `npm run build` commands and where the output lands, but not how
you implement the build behind them. Plain TypeScript with Canvas 2D is entirely
sufficient; a framework is not required. Favor a clean, well-structured codebase
over any particular technology. **You design the surge's exact spawn timing and
the per-wave composition** (within the constraints in `specs/creeps.md` and
`specs/flow.md`), and the player designs their own maze at runtime — there is no
fixed maze, and you must not ship one.

## Coordinate system and presentation

All positions, sizes, speeds, and ranges in this document are given in **logical
pixels** on a fixed 1280 x 720 stage (16:9). The origin `(0, 0)` is the
top-left; `x` increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space.
  The game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete `1280
  x 720` area is visible at once — the entire reactor floor, the full build
  panel, and all four edges — fitted to the window and centered, with nothing
  clipped or pushed past the edges. The build must fit correctly on load, before
  any input, and at any pixel density.

The stage is divided into the **reactor** on the left — `x` in `[0, 986]`, `y`
in `[0, 720]` — and the **build panel** on the right — `x` in `[986, 1280]` (294
px wide), full height. The reactor is a `950 x 684` **reactor floor** ringed by an
**18-px casing wall**; the surge can enter or leave only through four **openings**
(two vents and two exhausts) cut into that casing. The floor is laid out on a
**tile grid**: tiles are **19 x 19** logical pixels, and the grid is **50 columns
x 36 rows** (`950 x 684`), its top-left corner at `(18, 18)` just inside the
casing. Column `c` (`0..49`) spans `x` in `[18 + 19c, 18 + 19(c + 1)]`; row `r`
(`0..35`) spans `y` in `[18 + 19r, 18 + 19(r + 1)]`. Towers occupy snapped **2 x
2** tile footprints, so tower placement and range use the center of that
footprint; surge movement still uses individual tile centers. The casing wall, the
grid geometry, the vents and exhausts, and the build panel are defined in full in
`specs/playfield.md`.

## Visual design

The look is an industrial reactor floor: cold dark steel and a faint
structural grid, with the action lit by **heat** — every emitter glows along a
temperature ramp from cool blue when idle to white-hot at the redline. The
canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Reactor floor / stage background | `#15181d` |
| Grid lines | `#23272e` |
| Build panel background | `#1b1f26` |
| Panel edges / dividers | `#2c323c` |
| Casing wall (solid steel) | `#3b434f` |
| Casing wall — lit inner rim | `#565f6d` |
| Emitter — cold (idle, weakest) | `#3a7bd5` |
| Emitter — warm | `#f2a43a` |
| Emitter — hot | `#ff5e2e` |
| Emitter — white-hot (near redline, strongest) | `#fff1d6` |
| Emitter — tripped / redline | `#ff3030` |
| Rime (cryo emitter) | `#79e0ff` |
| Forge (heat source) | `#ff7a1f` |
| Sink (heat sink) | `#aebfce` |
| Surge — ground intruder | `#a4e22a` |
| Surge — flyer | `#b66bff` |
| Surge — boss | `#8a2be2` |
| Surge health bar | `#2ec27e` |
| Vent (entrance) | `#5f9bd6` |
| Exhaust (exit) — hazard | `#ff5a3c` |
| Money / readouts | `#ffcf4d` |
| Hazard stripe | `#ffd400` |
| Valid placement | `#46d07a` |
| Invalid placement | `#ff4d4d` |
| Primary text | `#e8edf3` |
| Secondary text | `#97a3b0` |
| Tertiary text / hints | `#5b6675` |

- Use a **monospace** type family for all text (title, menus, HUD, panel,
  labels). Do not depend on a web font that must be downloaded; a system
  monospace stack is required so the game renders identically offline.
- The structural grid is faint but always visible on the floor, so the player
  can read tiles and plan a maze. The casing wall encloses the floor; its vents
  glow a cool blue and its exhausts are hazard-striped and read as dangerous (the
  surge escaping there is what costs you).
- **Heat must be readable at a glance, and by more than color alone.** An
  emitter's glow color tracks its heat along the ramp above — cold blue →
  warm amber → hot orange → white-hot just under the redline — and a tripped
  emitter is unmistakable (strobing red, visibly offline). Because heat is the
  heart of the game, also give each tower a small heat read (for example a
  short bar or ring segment on its 2 x 2 footprint) so a player can tell a
  tower at `90%` heat from one at `30%` without guessing from glow alone. Pick
  one convention and use it consistently. The cryo Rime is the exception that
  proves the rule: it reads cold/cyan and you *want* it cold (see
  `specs/heat.md`).
- Keep the surge **off the temperature axis** so it never reads as "heat":
  ground intruders are acid green, flyers violet, the boss a deep violet — never
  the blue→red of the emitter ramp.
- The three canonical screens — the title screen, the in-match view, and the
  game-over screen — are described in full under Game states in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-match frame, mid-wave.
- `reference/game-over.png` — the game-over screen.

Treat them as visual targets: match their layout, palette, and type. They are
images only — and the maze, towers, and surge they show are just **one example
moment**. Build the screens from this specification, and the maze is the
player's to build at runtime; design your own conforming game, not a copy of the
frame.
