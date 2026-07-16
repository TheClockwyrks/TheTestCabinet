# Locomotivation

## Overview

**Locomotivation** is a rail-yard hauling **arcade game** for the browser, shown
from a **¾ overhead angle** in the manner of *Stardew Valley*: the camera looks
down and slightly forward, so the yard reads as a grid seen from above **and** the
worker, the trains, the buildings, and the signals are real sprites with a visible
**front and side** and a sense of height — not flat top-down icons.

You are a **yard worker** on a busy interlocking. Each shift, your job is to **haul
color-matched freight** from where it is dispensed to its matching drop zone —
but the yard is **alive with trains** running fixed, published schedules, and
**touching any part of a train, its sides included, kills you instantly** (the
Frogger contract). The whole game turns on one tension: **the freight you carry
slows you down**, and a heavy enough load costs you your sprint, so every pickup is
a wager against the crossings you still have to make.

The loop that drives the game is:

> **pick up color-matched freight → route it across the live tracks → deliver it
> to the matching zone → repeat until the shift quota is met, before the clock
> runs out.**

Crossing is the whole skill. Trains are **deterministic and telegraphed** — fixed
schedules, crossing signals, horns, headlights, a rising rumble — so a death is
always *your* misread, never a surprise. Between two parallel tracks the gap is
safe; **bridges** and single-track cuts force you to commit to being *on* a track
for an extended run, with **refuge bays** to duck into. You can **drop** freight to
save yourself, but cargo left on the rails is **smashed by the next train**; you
have a **shift clock** and **three lives**; some freight is a **one-of-a-kind
package** that fails the shift if you lose it; and when a level offers one, an
optional **last train** departs exactly as the shift ends — board its rideable
flat-top cars for a large bonus, or watch it go.

The worker is a **character**, not a cursor — and how believably it **moves and
animates in the ¾ view**, turning to face each of four directions and visibly
straining under a load, is half of what this build is judged on.

**You also produce the game's art, effects, and audio yourself.** Locomotivation
ships with **no** pre-made sprites, effects, or sounds. The run image puts six
asset-generation tools on your `PATH`, and you must author every asset the game
plays — above all the **animated worker** across its motion states in **all four
facings**, and the **trains** as chunky ¾ bodies — with those tools during this
build. The full contract is `specs/assets.md`; read it as carefully as the
simulation specs, because the **produced presentation** is half of what this build
is judged on.

## How the specification is organized

This specification is split across several files. Read **all** of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: the pitch, the ¾ perspective, goals, hard
  requirements, free choices, the coordinate system, the stage and tile grid, the
  palette and type, and the visual design.
- `specs/world.md` — the **yard**: the tile grid and coordinate system, the ¾ draw
  order, every **tile kind** (ground, track, bridge, refuge bay, wall, gap), how a
  level is assembled from corridors, forced crossings, dispensers, drop zones, the
  spawn, and levers.
- `specs/character.md` — the **worker**: continuous four-direction movement and its
  **four facings**, the **carry-weight speed model**, the **recharging sprint**,
  picking up and **multi-carrying**, **dropping**, death and respawn, and the full
  set of **directional animation states**. **Read this carefully.**
- `specs/cargo.md` — the **freight**: the package **colors** and **weight
  classes**, the three **archetypes** (unique / dispenser / optional), pickup and
  **color-matched delivery**, and the **drop and destructible-cargo** rules. **Read
  this carefully.**
- `specs/trains.md` — the **trains**: the three kinds (freight, commuter, bullet),
  their **deterministic schedules**, the **telegraphing**, **lethal** contact, the
  junction **switches**, and the optional derived **last-train** bonus. **Read this
  carefully.**
- `specs/levels.md` — the **six campaign levels**: each level's layout, cargo,
  drop zones, train roster and schedule, shift clock, and quota. **Read this
  carefully.**
- `specs/flow.md` — the **shift** economy: the clock and lives, win and fail,
  scoring, the game state machine, the required menus, and the HUD.
- `specs/controls.md` — the fixed-timestep simulation and the keyboard controls.
- `specs/assets.md` — the **asset-production contract**: every sprite, animated
  sheet, particle system, sound, and music track you must produce with the on-`PATH`
  tools, where each lands, and how each is wired in. The **animated worker** and the
  **trains** are the centerpieces. **Read this carefully.**
- `specs/proof.md` — the proof-of-implementation captures the finished build must
  write.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: a fixed-step real-time simulation of a
character moving and carrying over a tiled yard in a ¾ view, deterministic
scheduled trains with lethal collision and telegraphing, a carry-weight movement
model and recharging sprint, three cargo archetypes with color-matched delivery
and destructible drops, forced bridge/refuge crossings and junction switches, a
per-level clock-and-lives shift, an optional derived last-train bonus, a
six-level campaign, multiple game states and menus, and a HUD — **and** a full
pass of producing the game's art, effects, and audio with the on-`PATH` tools, the
**animated worker** above all. Aim for a build a person would actually want to
play — tense, legible, and alive — not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this
  requirement.
- **Produces its own assets.** Every sprite, animation, particle effect, and sound
  the game plays must be **produced during this build with the six tools on your
  `PATH`** (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`,
  `music`), per `specs/assets.md`. Do not ship placeholder rectangles, ad-hoc
  code-drawn art in place of a sprite, flat flashes in place of the produced
  particle VFX, downloaded assets, or silence.
- **Runs in the browser with no backend.** No server, accounts, database, or
  network calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a
  `package.json` at its root, buildable with **only Node.js and npm-installed
  dependencies** (no separately installed language toolchain). **Commit a
  `package-lock.json`**: the build is installed with `npm ci`. Running `npm ci`
  and then `npm run build` must produce the complete static site, with no further
  manual step, into one of `dist/`, `build/`, or `out/` at the project root, with
  an `index.html` at the root of that directory as the entry point. That output
  must run correctly when served as-is **at any base path, not only the server
  root** — it is played back mounted under a per-run sub-path (like
  `/runs/<id>/build/`), so every URL the build requests must resolve **relative to
  the page** rather than the origin root (no root-absolute `/…` URLs; a relative
  bundler base such as Vite's `base: './'`). `specs/assets.md` states the loading
  rule in full; it governs the produced assets and the bundled JS/CSS alike. You
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
particular technology. **You design the exact visual identity** of the worker and
its animations, the trains, the yard tiles, the packages and zones, the buildings
and signals — there is no pixel-exact layout to reproduce, only the grid, the
movement and weight numbers, the train speeds and lengths, the schedules, the level
layouts, the clocks and quotas, and the behavior the specs pin. The exact painterly
look within the palette is yours.

## Coordinate system and presentation

All positions, sizes, and speeds in this document are given in **logical pixels** on
a fixed **1280 x 720** stage (16:9). The origin `(0, 0)` is the **top-left**; `x`
increases to the right and `y` increases downward. Speeds are in logical pixels per
second.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the letterbox color on the remaining space. The
  game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete
  `1280 x 720` area is visible at once — the top status bar and the full yard
  viewport, all four edges — fitted to the window and centered, with nothing
  clipped. The build must fit correctly on load, before any input, at any pixel
  density.

The stage is divided into two regions (`specs/world.md` details each):

- a **top status bar** — `y` in `[0, 80]`, full width — with the shift clock, the
  per-color quota, lives, the carried-load weight bar, the sprint bar, and the
  pause/mute controls;
- the **yard viewport** — `x` in `[0, 1280]`, `y` in `[80, 720]` (1280 x 640) — the
  ¾ view of the tiled level: the ground, the tracks and bridges, the dispensers,
  drop zones, buildings and signals, the trains, the worker, and the effects.

The camera is **fixed per level** — each level's whole compact layout fits the
viewport at once, so the view never scrolls. Menus and panels open as **overlays**
over the viewport.

## The ¾ overhead view

Render the yard the way *Stardew Valley* does — a **¾ overhead** projection, not a
pure orthographic top-down:

- The ground grid is seen from above and slightly forward, so tiles read as a
  floor.
- **Sprites stand up.** The worker, the trains, the dispensers, the buildings, the
  signals, and the packages are drawn as upright sprites with a visible **front
  and side face** and height, anchored at their **base** (their footprint tile),
  casting a small contact shadow.
- **Draw order sells the depth.** Entities are painted back-to-front by their base
  `y` (a "painter's" sort), so a worker standing below a train is drawn in front of
  it and one above is drawn behind it. Taller things (buildings, train bodies)
  occlude what is behind them.
- **The worker faces four directions.** Moving down, up, left, or right shows a
  distinct front / back / left / right sprite and walk cycle — a real character,
  not a single sprite mirrored (`specs/character.md`, `specs/assets.md`).
- **Trains are chunky bodies.** A horizontal train shows its long **flank**; a
  vertical train shows its **front/back**. Cars have a top and a side, not a flat
  bar (`specs/trains.md`, `specs/assets.md`).

Gameplay itself is still grid-and-cardinal: the worker moves in the four cardinal
directions on the tile grid, and collisions are computed in logical-pixel space.
The ¾ projection is a **rendering** treatment; it does not add a real z-axis to the
simulation.

## Visual design

The look is a **working industrial rail yard** at golden hour: gravel and grass
underfoot, rust-and-steel tracks, weathered timber sleepers, painted signal
housings, and boldly color-coded freight so a package's destination reads at a
glance. Warm, saturated, and legible — *Stardew*'s painterly clarity applied to a
switching yard. The canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Letterbox / void | `#0d0f12` |
| Status bar / panels | `#171b21` |
| Yard ground (gravel) | `#6b6357` |
| Grass patch (ground accent) | `#5f7048` |
| Track ballast (stone bed) | `#463d34` |
| Rail (steel) | `#b9bec6` |
| Sleeper / tie (timber) | `#3c2f26` |
| Bridge deck (timber) | `#6a4a33` |
| Gap / water (impassable) | `#24384a` |
| Refuge bay / platform | `#8a8f98` |
| Wall / building body | `#3a3f47` |
| Building roof (¾ top) | `#4b525b` |
| Faint tile grid | `#ffffff10` |
| Red freight | `#e2503b` |
| Blue freight | `#3f8ae0` |
| Green freight | `#46b95c` |
| Amber freight | `#f2b03d` |
| Signal — clear | `#46c96a` |
| Signal — warning | `#ffcf4a` |
| Signal — danger / alarm | `#ff5a52` |
| Worker (hi-vis accent) | `#ffd23a` |
| Worker (overalls) | `#c8562e` |
| Freight train body | `#6b7280` |
| Commuter train body | `#c9d0d8` |
| Bullet train body | `#eef2f7` |
| Headlight glow | `#fff2c4` |
| Shift clock (gauge) | `#e8eef5` |
| Sprint (gauge) | `#5ad0e6` |
| Load / weight (gauge) | `#c48a52` |
| Score / bonus | `#ffd23a` |
| Primary text | `#f0f2f5` |
| Secondary text | `#a7b0ba` |
| Tertiary text / hints | `#6b7580` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do not
  depend on a downloaded web font; a system monospace stack is required so the game
  renders identically offline.
- Keep the yard legible: a player must tell safe ground from a live track, a bridge
  from the impassable gap beside it, a package's color from its matching zone, a
  refuge bay from open track, and a warning signal from a clear one — at a glance.
- **The animated worker is the headline of this build.** It reads as a believable
  character in the ¾ view, **faces four directions**, and animates distinctly for
  each thing it does — standing, walking, sprinting, carrying (visibly laden),
  dropping, and being squished. These are **produced sprite-sheet cycles**
  (`specs/assets.md`, `specs/character.md`). A stiff, single-frame worker is a
  failed build.
- **The trains are the co-star.** Each kind is an unmistakable ¾ body drawn to its
  track's orientation, telegraphed by produced signals, headlights, and audio.
- **You produce the art, effects, and audio** with the on-`PATH` tools — see
  `specs/assets.md`. The HUD, menu chrome, the crossing telegraph cues, the tile
  grid, and the gauges come from your code, in this palette.
- The canonical screens — the title, a live level, a bridge crossing, and the
  result screens — are described under Game states in `specs/flow.md`. Implement
  each as described, in this palette and type.

## Reference images

A `reference/` folder may accompany this specification with screenshots of the key
screens (the title, a live crossing, a bridge, a result screen). Treat any such
image as an **illustrative example, not a target to reproduce**: it shows one way
the screens can look, but design your own worker, trains, tiles, and layout from
this specification rather than copying it. The only firm requirement is that every
menu and navigation path this specification mandates is present, rendered in the
palette and type the spec defines.
