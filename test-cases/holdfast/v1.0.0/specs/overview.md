# Holdfast

## Overview

**Holdfast** is a top-down colony survival-management game for the browser. You look
down on a single patch of frontier — soil and grass, stands of trees, veins of ore,
and outcrops of impassable rock — and you direct a small band of settlers to gather
what the land offers, build a defensible base, feed themselves, and hold that base
against raiders who come for what they have built. You do not control a settler
directly: you designate work and set priorities, and the settlers decide who does
what and carry it out.

Holdfast's defining pressure is the **raid**. A **threat director** sends escalating
raids of hostiles on a timer that quickens as the colony grows richer, and they come
with guns. Between raids the colony has to turn the map into a working home — chop
wood and mine ore, build walls and beds and a stove, plant and harvest and cook food,
and stand up turrets and armed defenders — all while the settlers' own needs (hunger,
rest, mood) run down and the day/night clock turns. Survival is the tension between
those two clocks: the colony must grow its defenses and its larder faster than the
raids escalate, or it is overrun. It is a small-scale colony sim in the spirit of
*RimWorld*, entirely its own, with layered systems — a top-down tile world, needs-
and-mood-driven settlers on a job queue, a build-and-food economy, a day/night cycle,
and a ranged-combat threat director — that interact.

**You also produce the game's art, effects, and audio yourself.** Holdfast ships with
**no** pre-made sprites, effects, or sounds. The run image puts six asset-generation
tools on your `PATH`, and you must author every asset the game plays — the settler and
raider animations, the terrain and structure sprites, the muzzle-flash and blood and
fire particle effects, and the sound and music — with those tools during this build.
The full contract for what to produce and how to wire it in is `specs/assets.md`; read
it as carefully as the simulation specs.

## How the specification is organized

This specification is split across several files. Read **all** of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, and the visual design.
- `specs/world.md` — the tile world: the top-down grid, terrain kinds, the camera,
  and the resource nodes (trees, ore) settlers chop and mine.
- `specs/settlers.md` — the settlers: their needs, mood, and skills, the job priority
  queue they pull work from, and how they pathfind. **Read this carefully.**
- `specs/economy.md` — the resource-and-build economy: designating work, hauling,
  build orders and structures, farming, and cooking food into meals.
- `specs/combat.md` — the threat director and combat: escalating raids, ranged fire,
  cover, turrets, and downed settlers who bleed out. **Read this carefully.**
- `specs/time.md` — the day/night cycle and how it presses on work, rest, and raids.
- `specs/controls.md` — the camera, the designation and build tools, the work-priority
  grid, and the simulation-speed and pause controls.
- `specs/flow.md` — survival pressure, the day count, scoring, the loss state, the
  game states, the HUD dashboard, audio, and what is out of scope.
- `specs/assets.md` — the **asset-production contract**: every asset you must produce
  with the on-`PATH` tools, where each lands, and how each is wired into the build.
  **Read this carefully.**
- the mode specs under `specs/modes/` — the playable start(s) and the main-menu entry
  for each. Read every mode spec present and implement the starts they define. The
  main menu lists those starts, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: a fixed-step simulation of a top-down tile
world, needs-and-mood-driven settlers that pathfind and work a priority job queue, a
gather/build/cook/farm economy, a day/night cycle, an escalating ranged-combat threat
director, a survival loss condition, multiple game states and menus, and a HUD
dashboard — **and** a full pass of producing the game's art, effects, and audio with
the on-`PATH` tools. Aim for a build a person would actually want to play — tense,
legible, and alive — not a tech demo.

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
particular technology. **You design the exact layout of the starting map and its
resource nodes, the full set of buildings, turrets, and defenses beyond the ones the
specs require, and how the colony reads on screen** (within the constraints in the
specs) — there is no fixed map to reproduce.

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
dashboard), the **colony view** (`y` in `[64, 656]`, full width, a camera looking
down on the tile world), and a **bottom HUD strip** (`y` in `[656, 720]`, the settler
roster and the build palette). The tile world is generally larger than the colony
view, so the colony view is a **camera** the player pans across it (`specs/world.md`,
`specs/controls.md`); the two HUD strips are fixed and always fully visible.

## Visual design

The look is **a frontier outpost seen from above**: warm daytime earth and green
under an open sky, cooling to a blue dark at night when the lamps and muzzle flashes
carry the scene. The colony reads as tidy human structure — walls, floors, beds, a
stove, farm rows, turrets — laid over rougher wild land, and the raiders come out of
the dark edges in hostile red. The canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Deep shadow / void (background) | `#14110d` |
| Soil / bare ground | `#5a4632` |
| Grass / fertile ground | `#6a7638` |
| Rock / impassable outcrop | `#38332c` |
| Tree / forest node | `#3f6b3a` |
| Ore node (mineral vein) | `#c9a24a` |
| Built structure (walls, beds, stove) | `#8a6a44` |
| Built floor / path | `#4a3f30` |
| Settler (colonist) | `#4f93c9` |
| Raider (hostile) | `#c0473f` |
| Food / crop | `#7cc45a` |
| Wood / material | `#b98b4e` |
| Health / medical | `#e05a6a` |
| Alert / danger | `#ff5a52` |
| Panels / overlays | `#1b1712` |
| Primary text | `#ece6db` |
| Secondary text | `#a89e8d` |
| Tertiary text / hints | `#6b6355` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is required
  so the game renders identically offline.
- The map is lit by daylight and, at night, by the colony's own light; keep it
  **legible** whatever the hour: a player must be able to tell soil from grass from
  rock, a resource node from bare ground, a built wall from wild land, and a settler
  from a raider, at a glance — and a night must never black the map out so far that
  the colony cannot be read (`specs/time.md`).
- **Settlers and raiders must be unmistakable, and readable by more than color
  alone.** The colonists (`#4f93c9`) and the raiders (`#c0473f`) are the core read of
  a raid, so besides the colors give each a distinct **silhouette or mark** (for
  example a helmet/tool the settlers carry vs. a hostile stance for the raiders), and
  name the sides in words on the HUD, so a colorblind player can still tell friend
  from foe.
- **You produce the art, effects, and audio** with the on-`PATH` tools — see
  `specs/assets.md`, which is the contract for the sprites, animations, particle
  effects, and audio, and how to load and wire each in. The HUD dashboard, menus,
  overlays, selection, the work-priority grid, and the day/night lighting all come
  from your code, in this palette.
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
spec defines. They are images only — and the exact map layout, structures, and
settler positions they show are just **one example moment**. Build the screens
from this specification, and design your own conforming colony.
