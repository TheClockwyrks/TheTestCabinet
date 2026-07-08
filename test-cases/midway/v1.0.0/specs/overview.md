# Midway

## Overview

**Midway** is a top-down theme-park management simulation for the browser. You
look **down** on a fenced plot of ground and grow it into a park: you lay the
**paths** guests walk, build the **rides** they queue for and the **stalls** they
buy from, price everything, hire the **staff** who keep it running, and try to
keep the guests happy and the park in the black. It is a small-scale tycoon game
in the spirit of *RollerCoaster Tycoon*, entirely its own, with layered systems —
a path-and-placement park grid, desire-driven guest AI, a queue-and-ride
simulation, a pricing-and-upkeep economy, staff, and a reputation feedback loop —
that interact.

Midway's defining tension is the **feedback loop between happiness and money**.
Guests arrive at a rate set by the park's **rating**; that rating is driven by how
happy your guests are and how clean and appealing the park is; happiness is driven
by getting rides and food they want at prices that feel fair, without waiting too
long in line or wading through litter — and all of that costs you money to build,
staff, and maintain. Price too high or let the park slide and guests sour, the
rating falls, arrivals dry up, and the park spirals into the red; get the balance
right and a growing, happy crowd funds a bigger, better park. Run out of money and
the park goes bankrupt.

**You also produce the game's art, effects, and audio yourself.** Midway ships
with **no** pre-made sprites, effects, or sounds. The run image puts six
asset-generation tools on your `PATH`, and you must author every asset the game
plays — the guest and ride animations, the path/ride/stall/scenery sprites, the
fireworks and steam particle effects, and the sound and music — with those tools
during this build. The full contract for what to produce and how to wire it in is
`specs/assets.md`; read it as carefully as the simulation specs.

## How the specification is organized

This specification is split across several files. Read **all** of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, and the visual design.
- `specs/park.md` — the park grid: the tile grid, ground and scenery, the paths
  guests walk, how rides and stalls are placed, and the camera.
- `specs/guests.md` — the guests: their desire model, how they choose what to do,
  how they spend, pathfind, and leave, and the happiness that drives everything.
  **Read this carefully.**
- `specs/rides.md` — the rides and stalls: capacity, ride time, throughput, the
  queues guests wait in, ride breakdowns, and what stalls sell.
- `specs/economy.md` — the money: admission and the prices you set, build cost,
  upkeep and wages, the budget, and bankruptcy.
- `specs/staff.md` — the staff: janitors, mechanics, and entertainers, how you
  hire, pay, and assign them, and how an unstaffed park degrades.
- `specs/controls.md` — the camera, the path/build/staff/price tools, and the
  simulation-speed and pause controls.
- `specs/flow.md` — the reputation feedback loop, the day clock, scoring, the loss
  state, the game states, the HUD dashboard, audio, and what is out of scope.
- `specs/assets.md` — the **asset-production contract**: every asset you must
  produce with the on-`PATH` tools, where each lands, and how each is wired into
  the build. **Read this carefully.**
- the mode specs under `specs/modes/` — the playable start(s) and the main-menu
  entry for each. Read every mode spec present and implement the starts they
  define. The main menu lists those starts, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: a fixed-step simulation of a park grid,
desire-driven guests that pathfind and queue, a ride-and-queue simulation with
breakdowns, a pricing-and-upkeep economy that can go bankrupt, staff that work the
park, a reputation feedback loop, multiple game states and menus, and a HUD
dashboard — **and** a full pass of producing the game's art, effects, and audio
with the on-`PATH` tools. Aim for a game a person would actually want to play —
lively, legible, and satisfying to grow — not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this
  test case.
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
particular technology. **You design the exact size and layout of the starting plot
and its entrance, the full set of rides, stalls, and scenery beyond the ones the
specs require, and how the park reads on screen** (within the constraints in the
specs) — there is no fixed park to reproduce.

## Coordinate system and presentation

All positions, sizes, and ranges in this document are given in **logical pixels** on
a fixed **1280 x 720** stage (16:9). The origin `(0, 0)` is the **top-left**; `x`
increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete
  `1280 x 720` area is visible at once — the full park view, both HUD strips, and
  all four edges — fitted to the window and centered, with nothing clipped or pushed
  past the edges. The build must fit correctly on load, before any input, and at any
  pixel density.

The stage is divided into a **top HUD strip** (`y` in `[0, 64]`, the park vitals
dashboard), the **park view** (`y` in `[64, 656]`, full width, a camera onto the
tile world), and a **bottom HUD strip** (`y` in `[656, 720]`, the build palette and
the selected-object / staff panel). The park is generally larger than the park
view, so the park view is a **camera** the player pans across it (`specs/park.md`,
`specs/controls.md`); the two HUD strips are fixed and always fully visible.

## Visual design

The look is **a sunny park at golden hour**: bright grass and paved paths, candy-
colored ride and stall roofs, and a warm crowd of guests moving along the paths,
all under a dusk-blue letterbox. The park should feel inviting and busy — the
opposite of a spreadsheet. The canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Grass / open ground | `#4f8f4a` |
| Paved path | `#cdae7d` |
| Water / pond | `#37a0c4` |
| Ride structure / track | `#8b93a7` |
| Stall / building roof | `#e0603c` |
| Scenery / foliage | `#2f7d3a` |
| Cash / money | `#5fce6e` |
| Reputation / stars | `#ffcb52` |
| Happiness / mood | `#ffd24a` |
| Thrill | `#c46bff` |
| Hunger / food | `#f59042` |
| Thirst / drink | `#45c6f0` |
| Guest | `#ff8fb0` |
| Alert / danger | `#ff5a52` |
| Background / void | `#0f1626` |
| Panels / overlays | `#16202f` |
| Primary text | `#f2efe8` |
| Secondary text | `#aeb6c6` |
| Tertiary text / hints | `#6d7789` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is required
  so the game renders identically offline.
- Keep the park legible: a player must be able to tell grass from path, one ride
  from another, a food stall from a restroom, and a happy crowd from an angry one,
  at a glance. Guests are small but readable, and the paths they crowd read as the
  arteries of the park.
- **Happiness and money must be readable by more than color alone.** The park
  rating (stars), the crowd's mood, and the cash balance are the core read of the
  game, so besides the colors above give each a distinct **shape and label** in the
  HUD — a star rating, a mood face or worded label, a signed cash figure — so a
  colorblind player can still tell a thriving park from a failing one.
- **You produce the art, effects, and audio** with the on-`PATH` tools — see
  `specs/assets.md`, which is the contract for the sprites, animations, particle
  effects, and audio, and how to load and wire each in. The HUD dashboard, menus,
  overlays, tool previews, and selection all come from your code, in this palette.
- The three canonical screens — the title screen, the in-park view, and the
  park-closed screen — are described in full under Game states in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-park frame, mid-play.
- `reference/game-over.png` — the park-closed screen.

Treat them as visual targets: match their layout, palette, and type. They are
images only — and the exact park layout, crowd, and ride positions they show are
just **one example moment**. Build the screens from this specification, and design
your own conforming park.
