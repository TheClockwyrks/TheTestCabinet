# Meltdown

## Overview

Meltdown is an open-field tower-defense game for the browser. Waves of "surge"
intruders pour in through the vents of a reactor floor and try to reach the
exhausts; you stop them by building emitter towers on the open floor. Your towers
are also walls, so you do not defend a fixed path. You build the maze the surge
must walk, winding it the long way around so your emitters have time to burn it
down.

The defining idea is heat as power. Every emitter fires harder the hotter it runs,
climbing to full power at its own redline and holding it there, but run all the way
to 100 and it trips offline to cool, leaving a hole in your defense. Laying out the
floor is a thermal problem as much as a spatial one. A tower sheds heat only
through the faces that touch open air, so pack your guns tight and their cores bake
and trip. You space and orient them instead: each tower has cyan radiator faces you
aim toward the open lane as you place it, and they come in 2x2, 3x3, and 4x4 sizes,
the big ones hitting harder but running hotter. Two support structures sculpt the
heat, a thermostatic Forge that warms its neighbors toward a setpoint and a Sink
that draws heat out, the only way to cool a boxed-in core. One emitter, the cryo
Rime, runs the rule backward and slows the surge best when it stays cold. Skilled
play is pacing heat across the floor, running a core in its plateau, keeping a
sniper fed, and holding the cryo line cold, not just walling a path.

Do not reproduce the assets, branding, characters, or exact design of any existing
game.

## How the specification is organized

This specification is split across several files. Read all of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md`: this file. Goals, hard requirements, free choices, the
  coordinate system, the palette and type, the visual design, and what is out of
  scope.
- `specs/reactor.md`: the geometry of the reactor. The casing wall, the tile grid,
  the vents and exhausts, how towers wall the floor, how the surge paths through
  the maze, and the build-panel and HUD layout.
- `specs/heat.md`: the signature systems. Heat as power, the heat-to-damage curve,
  the redline trip, surface cooling, conduction between neighbors, and the three
  thermal stances. Read this carefully.
- `specs/towers.md`: the eight tower types, six emitters plus the Forge and Sink,
  their stats and thermal personalities, and how you build, upgrade, and sell them.
- `specs/surge.md`: the surge. The intruder types, the flyers that ignore the maze,
  and how a wave is composed.
- `specs/controls.md`: the mouse and keyboard controls. Placing, selecting,
  upgrading and selling towers, sending waves, game speed, and pause.
- `specs/economy.md`: the money, bounties, interest, and bonuses, lives and leaks,
  and scoring.
- `specs/waves.md`: the wave progression. The build phases, the run of waves,
  milestone waves, difficulty scaling, and victory and loss.
- `specs/states.md`: the game's state machine, the required menus, and the HUD.
- `specs/modes.md`: the modes reachable from the menu. The standard Containment
  mode and its Easy, Medium, and Hard difficulties, and the special modes, plus the
  content of the mode-select and difficulty-select menus.
- `specs/instrumentation.md`: the `window.__meltdown` debugging and automation API,
  the debug overlay, and the deterministic, steppable core they rest on.

## Goal of this build

Produce a complete, polished, playable game that runs entirely in a browser. This
is a substantial front-end task: real-time rendered graphics, a fixed-step
simulation, grid-based tower placement with live maze re-pathing, eight tower types
each with a distinct thermal behavior, a heat-to-damage model with a redline trip,
upgrade and economy systems, several surge types including flyers, a wave
progression with a win and a loss, multiple game states and menus, and a HUD. Aim
for a build a person would actually want to play, tense and readable, not a tech
demo.

### Hard requirements

- Renders real graphics. Draw the game with Canvas 2D, WebGL/WebGPU, or positioned
  DOM elements. A text-only or ASCII rendering does not satisfy this requirement.
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
  served as-is at the root of any static file server, since it is deployed to static
  hosting exactly that way. You choose the language, framework, bundler, and
  rendering approach behind this interface; only the `npm ci` and `npm run build`
  commands and where the build output lands are fixed.
- Documentation. Include a `README.md` in the produced repository explaining what
  the game is, how to install dependencies, how to run it in development, how to
  produce the static production build, and the controls.
- Expose the `window.__meltdown` API and the read-only debug overlay described in
  `specs/instrumentation.md`, backed by the deterministic, steppable core the
  simulation model in `specs/controls.md` requires. This is a required part of the
  build.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to the
requirements above, including the npm-driven static build, which fixes the `npm ci`
and `npm run build` commands and where the output lands but not how you implement
the build behind them. Plain TypeScript with Canvas 2D is entirely sufficient; a
framework is not required. Favor a clean, well-structured codebase over any
particular technology. The surge's exact spawn timing and per-wave composition are
specified in `specs/surge.md` and `specs/waves.md`; implement them as written. The
player designs their own maze at runtime. There is no fixed maze, and you must not
ship one.

## Coordinate system and presentation

All positions, sizes, speeds, and ranges in this document are given in logical
pixels on a fixed 1280 x 720 stage (16:9). The origin (0, 0) is the top-left; `x`
increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game remains correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- The whole stage must be on screen. At every window size the complete 1280 x 720
  area is visible at once, the entire reactor floor, the full build panel, and all
  four edges, fitted to the window and centered, with nothing clipped or pushed past
  the edges. The build fits correctly on load, before any input, and at any pixel
  density.

The stage is divided into the reactor on the left, `x` in `[0, 986]`, `y` in
`[0, 720]`, and the build panel on the right, `x` in `[986, 1280]` (294 px wide),
full height. The reactor is a 950 x 684 reactor floor ringed by an 18-px casing
wall; the surge can enter or leave only through four openings (two vents and two
exhausts) cut into that casing. The floor is laid out on a tile grid: tiles are
19 x 19 logical pixels, and the grid is 50 columns by 36 rows (950 x 684), its
top-left corner at (18, 18) just inside the casing. Column `c` (`0..49`) spans `x`
in `[18 + 19c, 18 + 19(c + 1)]`; row `r` (`0..35`) spans `y` in
`[18 + 19r, 18 + 19(r + 1)]`. Towers occupy snapped `size x size` tile footprints
(2x2, 3x3, or 4x4; `specs/towers.md`), so tower placement and range use the center
of that footprint; surge movement uses individual tile centers. The casing wall,
the grid geometry, the vents and exhausts, and the build panel are defined in full
in `specs/reactor.md`.

## Visual design

The look is an industrial reactor floor: cold dark steel and a faint structural
grid, with the action lit by heat. Every emitter glows along a temperature ramp
from cool blue when idle to white-hot at the redline. The canonical palette and
type are below; match them.

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

- Use a monospace type family for all text (title, menus, HUD, panel, labels). Do
  not depend on a web font that must be downloaded; a system monospace stack is
  required so the game renders identically offline.
- The structural grid is faint but always visible on the floor, so the player can
  read tiles and plan a maze. The casing wall encloses the floor; its vents glow a
  cool blue and its exhausts are hazard-striped and read as dangerous, since the
  surge escaping there is what costs you.
- Heat must be readable at a glance, and by more than color alone. An emitter's glow
  color tracks its heat along the ramp above, cold blue to warm amber to hot orange
  to white-hot near the trip, and a tripped emitter is unmistakable, strobing red
  and visibly offline. Because heat is the heart of the game, also give each tower a
  small heat read (for example a short bar on its footprint) with its redline
  (max-efficiency) marker shown, so a player can tell a tower sitting in its plateau
  from one that is cold or about to trip. Draw each tower's radiator faces
  distinctly (cool cyan fins) so the player can see which sides shed heat and aim
  them at open air. Pick one convention per read and use it consistently. The cryo
  Rime reads cold and cyan, and you want it cold (`specs/heat.md`).
- Keep the surge off the temperature axis so it never reads as heat: ground
  intruders are acid green, flyers violet, the boss a deep violet, never the blue to
  red of the emitter ramp.
- The canonical screens and menus, the title and main menu, the mode-select and
  difficulty-select menus, the in-match view, and the end screens, are described in
  full under Game states and Required menus in `specs/states.md` (and the mode
  content in `specs/modes.md`). Implement each as described, in this palette and
  type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png`: the title screen and main menu.
- `reference/mode-select.png`: the mode-select menu, with a mode's info shown.
- `reference/gameplay.png`: a representative in-match frame, mid-wave.
- `reference/game-over.png`: the game-over screen.

Treat them as illustrative examples, not targets to reproduce: they show one way
the screens can look, but design your own menus and layout rather than copy them.
The only firm requirement is that every menu and navigation path this specification
mandates is present, rendered in the palette and type the spec defines. They are
images only, and the maze, towers, and surge they show are just one example moment.
Build the screens from this specification, and the maze is the player's to build at
runtime; design your own conforming game, not a copy of the frame.

## Out of scope

- Network or online multiplayer, and any saved or persisted progress between
  sessions.
- Touch or gamepad input (mouse and keyboard only for this version).
- A map editor, multiple maps, or procedurally generated floors. This version is
  the one fixed floor of `specs/reactor.md`.
- An in-run research or tech tree beyond the per-tower upgrades of `specs/towers.md`.
