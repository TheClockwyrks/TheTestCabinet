# Junction

## Overview

**Junction** is a top-down transit-and-utility city builder for the browser. You
look **straight down** on a patch of land and grow a city on it: you **zone** land
for homes, shops, and industry; you lay the **roads and rail** that carry citizens
to work and goods to market; and you run the **power and water** that let it all
develop. The buildings raise themselves — you never place a house — but only where
the land is zoned, connected, served, and worth building on. Your job is to keep the
whole machine flowing and paying for itself.

Junction's defining tension is that **everything is connected**. A zone develops only
if a road reaches it and power and water flow to it; a new neighborhood loads the
roads its citizens commute on, and an overloaded road **congests** and slows every
trip across it; industry drives the jobs that grow housing but poisons the land
around it; and every road, rail, pipe, and wire charges **upkeep** against a treasury
that a too-fast or too-sprawling city drains into the red. Left unbalanced the city
gridlocks, stops growing, or goes **bankrupt**. So the game is a balancing act across
layered systems — a self-developing zoned map, a transit network with real flow
pressure, power and water networks, an RCI demand economy, and a budget — that all
interact. It is a small-scale city simulation in the spirit of *SimCity* and the
flow-pressure of *Mini Metro*, entirely its own.

**You also produce the game's art, effects, and audio yourself.** Junction ships with
**no** pre-made sprites, effects, or sounds. The run image puts six asset-generation
tools on your `PATH`, and you must author every asset the game plays — the zone,
road, rail, and utility sprites, the animated signal and construction and vehicle
sheets, the pollution and construction and milestone particle overlays, and the sound
and music — with those tools during this build. The full contract for what to produce
and how to wire it in is `specs/assets.md`; read it as carefully as the simulation
specs.

## How the specification is organized

This specification is split across several files. Read **all** of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, and the visual design.
- `specs/map.md` — the city map: the tile grid, terrain, the three zone kinds and how
  zoned tiles develop and abandon through density tiers, the camera, and how
  pollution and land value color development.
- `specs/transit.md` — the transit network: roads, the rail/metro line and its
  stations, how citizens and goods path across the connected network, and the
  congestion that builds on overloaded links. **Read this carefully.**
- `specs/utilities.md` — the utility networks: power generation and wires, water
  sources and pipes, how supply propagates, and what an unserved zone does.
- `specs/economy.md` — the demand-and-money economy: the RCI demand curves that drive
  growth, the pollution and land-value feedback loops, and the budget of tax income
  against upkeep that can end in bankruptcy.
- `specs/controls.md` — the camera, the zone/road/rail/utility/bulldoze tools, the
  overlays, and the simulation-speed and pause controls.
- `specs/flow.md` — the shape of a game: the growth-and-solvency pressure, the clock,
  scoring, the bankruptcy loss state, the game states, the HUD dashboard, audio, and
  what is out of scope.
- `specs/assets.md` — the **asset-production contract**: every asset you must produce
  with the on-`PATH` tools, where each lands, and how each is wired into the build.
  **Read this carefully.**
- the mode specs under `specs/modes/` — the playable start(s) and the main-menu entry
  for each. Read every mode spec present and implement the starts they define. The
  main menu lists those starts, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser. This
is a substantial front-end task: a fixed-step simulation of a zoned tile map that
develops itself, a transit network citizens path across with flow-pressure congestion,
power and water networks whose supply propagates, an RCI demand economy with pollution
and land-value feedback, a real budget with a bankruptcy loss condition, multiple game
states and menus, and a HUD dashboard — **and** a full pass of producing the game's
art, effects, and audio with the on-`PATH` tools. Aim for a build a person would
actually want to play — legible, responsive, and alive — not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this requirement.
- **Produces its own assets.** Every sprite, animation, particle effect, and sound the
  game plays must be **produced during this build with the six tools on your `PATH`**
  (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music`), per
  `specs/assets.md`. Do not ship placeholder rectangles, ad-hoc code-drawn art in
  place of a sprite, downloaded assets, or silence.
- **Runs in the browser with no backend.** No server, accounts, database, or network
  calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a
  `package.json` at its root, buildable with **only Node.js and npm-installed
  dependencies** (no separately installed language toolchain). **Commit a
  `package-lock.json`**: the build is installed with `npm ci`, which requires that
  lockfile. Running `npm ci` and then `npm run build` must produce the complete static
  site, with no further manual step, into one of `dist/`, `build/`, or `out/` at the
  project root, with an `index.html` at the root of that directory as the entry point.
  That output directory must run correctly when served as-is from a static file server
  **at any base path, not only the server root** — when it is played back it is mounted
  under a per-run sub-path (a path like `/runs/<id>/build/`), so every URL the build
  requests must resolve relative to the page rather than the origin root.
  `specs/assets.md` states the loading rule in full (no root-absolute `/…` URLs; a
  relative bundler base such as Vite's `base: './'`); it governs the produced assets
  and the bundled JS/CSS alike. You choose the language, framework, bundler, and
  rendering approach behind this interface; only the `npm ci` and `npm run build`
  commands and where the build output lands are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining what
  the game is, how to install dependencies, how to run it in development, how to
  produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to the
requirements above. Plain TypeScript with Canvas 2D is entirely sufficient; a
framework is not required. Favor a clean, well-structured codebase over any particular
technology. **You design the exact layout of the starting map and its terrain, the
full set of buildable things beyond the ones the specs require, and how the city
reads on screen** (within the constraints in the specs) —
there is no fixed map to reproduce.

## Coordinate system and presentation

All positions, sizes, and ranges in this document are given in **logical pixels** on a
fixed **1280 x 720** stage (16:9). The origin `(0, 0)` is the **top-left**; `x`
increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The game
  must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete
  `1280 x 720` area is visible at once — the full city view, both HUD strips, and all
  four edges — fitted to the window and centered, with nothing clipped or pushed past
  the edges. The build must fit correctly on load, before any input, and at any pixel
  density.

The stage is divided into a **top HUD strip** (`y` in `[0, 64]`, the city vitals
dashboard), the **city view** (`y` in `[64, 656]`, full width, a top-down camera onto
the tile map), and a **bottom HUD strip** (`y` in `[656, 720]`, the RCI demand meters
and the build palette). The tile map is generally larger than the city view, so the
city view is a **camera** the player pans across it (`specs/map.md`,
`specs/controls.md`); the two HUD strips are fixed and always fully visible.

## Visual design

The look is a **clean top-down city map at night**: dark ground so the colored
systems read like a live transit-and-services map — green homes, blue shops, amber
industry, grey roads, a bright transit line, glowing power, cool water — over it.
Legibility is everything: a player must read the state of the city at a glance. The
canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Ground / undeveloped land (background) | `#12161c` |
| Terrain — bare earth / dirt | `#2a2f26` |
| Terrain — grass / park | `#33502f` |
| Terrain — water | `#245a73` |
| Terrain — hill / rock (unbuildable rise) | `#3a3630` |
| Residential zone | `#4caf6d` |
| Commercial zone | `#4a90d9` |
| Industrial zone | `#e0a63c` |
| Road | `#3c434d` |
| Rail / metro line | `#b061e6` |
| Station / stop | `#ece6db` |
| Power / energy | `#ffcb52` |
| Water supply (pipe) | `#47c8e0` |
| Congestion / gridlock | `#ff7a3c` |
| Pollution | `#8a7d5a` |
| Money / positive balance | `#7cd45a` |
| Alert / deficit / danger | `#ff5a52` |
| Panels / overlays | `#161b22` |
| Primary text | `#e6ebf0` |
| Secondary text | `#9aa4af` |
| Tertiary text / hints | `#5b6570` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is required so
  the game renders identically offline.
- The map is read from directly above. Keep it legible: a player must be able to tell
  the three zone kinds apart, an empty zoned lot from a developed one, a low-density
  building from a high one, a road from a rail line, and served land from unserved, at
  a glance — by shape and value as well as hue.
- **The three zones and the two networks must be unmistakable, and readable by more
  than color alone.** Residential (`#4caf6d`), commercial (`#4a90d9`), and industrial
  (`#e0a63c`) each get a distinct **building form** as well as its hue; roads
  (`#3c434d`) and the rail line (`#b061e6`) read as clearly different kinds of link.
  The HUD names each in words too, so a colorblind player can still tell homes from
  shops from factories and road from rail.
- **You produce the art, effects, and audio** with the on-`PATH` tools — see
  `specs/assets.md`, which is the contract for the sprites, animations, particle
  overlays, and audio, and how to load and wire each in. The HUD dashboard, menus,
  overlays, selection, the traffic and utility overlays, and the pollution overlay's
  driving all come from your code, in this palette.
- The three canonical screens — the title screen, the in-city view, and the
  bankruptcy screen — are described in full under Game states in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-city frame, mid-play.
- `reference/game-over.png` — the bankruptcy screen.

Treat them as **illustrative examples, not targets to reproduce**: they show
one way the screens can look, but design your own menus and layout rather than
copy them. The only firm requirement is that every menu and navigation path
this specification mandates is present, rendered in the palette and type the
spec defines. They are images only — and the exact city layout, network, and
traffic they show are just **one example moment**. Build the screens from this
specification, and design your own conforming city.
