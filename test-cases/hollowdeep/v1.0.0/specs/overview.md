# Hollowdeep

## Overview

**Hollowdeep** is a side-view sealed-colony survival simulation for the browser.
You look at a **cross-section** of a sealed underground — layers of dirt, ore, and
rock — and you keep a small crew of colonists, the **delvers**, alive. You dig into
the earth to open living space and mine resources, then build the machines and
farms that make that space survivable: the air the delvers breathe, the power that
runs the machines, and the food they eat.

Hollowdeep's defining pressure is the **air economy**. The colony begins with a
finite pocket of breathable **oxygen**; every delver breathes it in and exhales
**CO2**, and both gases spread through the open space you dig. Left alone the pocket
sours — oxygen thins, CO2 pools in the low tunnels — and the delvers suffocate. So
survival is a race: dig, refine, and build oxygen generation and a food source
before the starting air runs out, then hold the colony steady against its own
consumption. It is a small-scale simulation game in the spirit of *Oxygen Not
Included*, entirely its own, with layered systems — a dig-able tile world, a
diffusing gas simulation, a power network, needs-driven delvers, and a build
economy — that interact.

**You also produce the game's art, effects, and audio yourself.** Hollowdeep ships
with **no** pre-made sprites, effects, or sounds. The run image puts six
asset-generation tools on your `PATH`, and you must author every asset the game
plays — the delver animations, the tile and machine sprites, the gas and dust
particle overlays, and the sound and music — with those tools during this build.
The full contract for what to produce and how to wire it in is `specs/assets.md`;
read it as carefully as the simulation specs.

## How the specification is organized

This specification is split across several files. Read **all** of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, and the visual design.
- `specs/world.md` — the tile world: the grid, the tile kinds, the camera, digging
  and the dig queue, and the resources digging yields.
- `specs/gas.md` — the gas simulation: oxygen and CO2, how they diffuse and settle,
  how delvers breathe, suffocation, and the live gas overlay. **Read this
  carefully.**
- `specs/power.md` — the power network: generators, wires, the machines (the
  oxygen diffuser and the pump), and brownouts.
- `specs/delvers.md` — the delvers: their needs, the job priority queue they pull
  work from, and how they pathfind across the colony.
- `specs/economy.md` — the resource and build economy: refining ore into build
  material, the build orders delvers construct, and the fungus farm that feeds the
  colony.
- `specs/controls.md` — the camera, the dig and build tools, priorities, and the
  simulation-speed and pause controls.
- `specs/flow.md` — survival pressure, the cycle clock, scoring, the loss state,
  the game states, the HUD dashboard, audio, and what is out of scope.
- `specs/assets.md` — the **asset-production contract**: every asset you must
  produce with the on-`PATH` tools, where each lands, and how each is wired into
  the build. **Read this carefully.**
- the mode specs under `specs/modes/` — the playable start(s) and the main-menu
  entry for each. Read every mode spec present and implement the starts they
  define. The main menu lists those starts, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: a fixed-step simulation of a tile world, a
diffusing two-gas economy, a power network, delvers that pathfind and work a job
queue, a resource-and-build loop, a survival-pressure loss condition, multiple game
states and menus, and a HUD dashboard — **and** a full pass of producing the game's
art, effects, and audio with the on-`PATH` tools. Aim for a build a person would
actually want to play — tense, legible, and alive — not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this
  requirement.
- **Produces its own assets.** Every sprite, animation, particle effect, and sound
  the game plays must be **produced during this build with the six tools on your
  `PATH`** (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`,
  `music`), per `specs/assets.md`. Do not ship placeholder rectangles, ad-hoc
  code-drawn art in place of a sprite, downloaded assets, or silence.
- **Runs in the browser with no backend.** No server, accounts, database, or
  network calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a
  `package.json` at its root, buildable with **only Node.js and npm-installed
  dependencies** (no separately installed language toolchain). **Commit a
  `package-lock.json`**: the build is installed with `npm ci`, which requires that
  lockfile. Running `npm ci` and then `npm run build` must produce the complete
  static site, with no further manual step, into one of `dist/`, `build/`, or
  `out/` at the project root, with an `index.html` at the root of that directory as
  the entry point. That output directory must run correctly when served as-is from
  a static file server **at any base path, not only the server root** — when it is
  played back it is mounted under a per-run sub-path (a path like
  `/runs/<id>/build/`), so every URL the build requests must resolve relative to the
  page rather than the origin root. `specs/assets.md` states the loading rule in
  full (no root-absolute `/…` URLs; a relative bundler base such as Vite's
  `base: './'`); it governs the produced assets and the bundled JS/CSS alike. You
  choose the language, framework, bundler, and rendering approach behind this
  interface; only the `npm ci` and `npm run build` commands and where the build
  output lands are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development, how
  to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to the
requirements above. Plain TypeScript with Canvas 2D is entirely sufficient; a
framework is not required. Favor a clean, well-structured codebase over any
particular technology. **You design the exact layout of the starting cavern and its
resource seams, the full set of buildings and machines beyond the ones the specs
require, and how the colony reads on screen** (within the constraints in the specs)
— there is no fixed map to reproduce.

## Coordinate system and presentation

All positions, sizes, and ranges in this document are given in **logical pixels** on
a fixed **1280 x 720** stage (16:9). The origin `(0, 0)` is the **top-left**; `x`
increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete
  `1280 x 720` area is visible at once — the full colony view, both HUD strips, and
  all four edges — fitted to the window and centered, with nothing clipped or pushed
  past the edges. The build must fit correctly on load, before any input, and at any
  pixel density.

The stage is divided into a **top HUD strip** (`y` in `[0, 64]`, the colony vitals
dashboard), the **colony view** (`y` in `[64, 656]`, full width, a camera onto the
tile world), and a **bottom HUD strip** (`y` in `[656, 720]`, the delver roster and
the build palette). The tile world is generally larger than the colony view, so the
colony view is a **camera** the player pans across it (`specs/world.md`,
`specs/controls.md`); the two HUD strips are fixed and always fully visible.

## Visual design

The look is **an industrial dig-site in the dark**: warm lamplight and machine glow
against cold packed earth, with the two gases — breathable oxygen and waste CO2 — as
the colored life of the scene, tinting the air you have opened up. The canonical
palette and type are below; match them.

| Element | Color |
| --- | --- |
| Deep rock / void (background) | `#12100c` |
| Dirt tile | `#4a3524` |
| Ore vein (in ore tiles) | `#d9a441` |
| Rock / bedrock | `#2b2620` |
| Open (dug) space | `#191410` |
| Built structure (walls, floors) | `#566073` |
| Ladder / wire | `#c9862f` |
| Oxygen (breathable air) | `#47e0c8` |
| CO2 (waste gas) | `#b6c24a` |
| Power / energy | `#ffcb52` |
| Food / fungus | `#7cd45a` |
| Delver suit | `#e08a3c` |
| Alert / danger | `#ff5a52` |
| Panels / overlays | `#1b1712` |
| Primary text | `#ece6db` |
| Secondary text | `#a89e8d` |
| Tertiary text / hints | `#6b6355` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is required
  so the game renders identically offline.
- The colony is lit from its lamps and machines; unlit rock is nearly black, and the
  open space you dig reads as a lit interior against it. Keep the tile world legible:
  a player must be able to tell dirt from ore from rock, open space from solid, and
  a built wall from natural stone, at a glance.
- **The two gases must be unmistakable, and readable by more than color alone.**
  Oxygen (`#47e0c8`) and CO2 (`#b6c24a`) are the core read of the survival game, so
  besides the colors above, give each a distinct **motion and form** in its overlay:
  oxygen reads as a fine, rising haze; CO2 as a heavier plume that settles into the
  low tunnels (matching the buoyancy in `specs/gas.md`). The HUD names them in words
  as well, so a colorblind player can still tell breathable air from waste.
- **You produce the art, effects, and audio** with the on-`PATH` tools — see
  `specs/assets.md`, which is the contract for the sprites, animations, particle
  overlays, and audio, and how to load and wire each in. The HUD dashboard, menus,
  overlays, selection, and the gas overlay's driving all come from your code, in
  this palette.
- The three canonical screens — the title screen, the in-colony view, and the
  colony-lost screen — are described in full under Game states in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-colony frame, mid-play.
- `reference/game-over.png` — the colony-lost screen.

Treat them as **illustrative examples, not targets to reproduce**: they show
one way the screens can look, but design your own menus and layout rather than
copy them. The only firm requirement is that every menu and navigation path
this specification mandates is present, rendered in the palette and type the
spec defines. They are images only — and the exact colony layout, gas spread,
and delver positions they show are just **one example moment**. Build the
screens from this specification, and design your own conforming colony.
