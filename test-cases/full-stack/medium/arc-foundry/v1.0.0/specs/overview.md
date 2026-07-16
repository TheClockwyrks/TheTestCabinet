# Arc Foundry

## Overview

**Arc Foundry** is an electro-industrial **tower-defense** game for the browser. A
runaway surge of conductive scrap and charged debris — **the Load** — floods out of
a blown **feeder vent** and crawls across a derelict substation yard toward a
**grounding collector**, where it dumps its charge and overloads the facility. You
defend the yard by feeding scrap into a **scrap-press** that stamps salvaged
electrical components — capacitors, coils, emitters, arc-nodes, discharge rigs —
into automated turrets. Every stamped component is *also* a physical obstacle: you
build a **maze** of scrap that the Load must crawl around, buying your turrets time
to burn it down before it grounds out. Every unit that reaches the collector costs
you **Grid Integrity**; every unit you burn down pays a bounty of **Charge** that
funds more stamps.

The twist that defines the game is what happens at the press. You do **not** buy a
component you choose — you place a **rock** that **rolls a random component type at a
random quality tier the instant it lands**, weighted low. Each level you place **five**
such rocks and take **exactly one** new firing tower off the level; every rock you do not
harvest hardens into an inert **blocker** that walls the yard but never fires. That one
harvest is a **KEEP** (resolved at SEND) or a **COMBINE SPECIAL** — folding this phase's rolls
up the quality ladder, or a whole recipe into a **combination tower**, which **ends the build
phase and sends the wave**. Once the wave is live you keep folding your **standing** towers
together with the plain **COMBINE** (immediate, no fresh roll spent) to climb quality and
assemble combos across the run. You also spend scarce kill income on **UPGRADE QUALITY** to
bias the press toward stronger gems and on **upgrading** your combos. Every rock is a wall no
matter what, so the **which-roll-to-harvest decision, the combines you fold across the waves,
the maze you wall, and the climb — is the heart of the game** (`specs/build.md`). This is a
faithful reskin of Gem Tower Defense.

Components come in **eight** base **types**, each an electrical part with a distinct
firing identity and signature VFX: the **Capacitor** (a crisp single-target bolt), the
**Coil** (chain-lightning that leaps between units), the **Emitter** (a rapid
low-damage spark), the **Arc-Node** (an area discharge), the **Discharge Rig**
(a slow long-range heavy bolt), the **Choke** (a low-damage bolt that **slows** the
unit it strikes), the **Rectifier** (a hit that sets an overcurrent **burn**, a
damage-over-time), and the **Regulator** (a **non-firing** support node that projects an
**aura**, buffing every firing tower around it). Beyond the base types, matched
ingredients can be assembled by **recipe** into roughly a dozen unique **combination
towers** — upgradeable turrets with their own stat blocks and abilities (slow, burn, crit,
multishot, aura) that are the payoff of climbing the board; each lands weak and is upgraded
with Charge (`specs/towers.md`, `specs/build.md`). Cutting across the base types is a five-rung
**quality ladder** — **Scrap → Tuned → Charged → Primed → Tesla-Prime** — that is the game's
power axis: a component's damage and range climb steeply with its tier. You climb the
ladder by **combining** two matching components (same type and same quality) into one a
tier higher, and by **refining the press** (UPGRADE QUALITY) so it rolls higher tiers to
begin with. A board full of Scrap looks like a junkyard and burns weakly; a Tesla-Prime
looks like a lightning god. The full type roster and the quality scaling live in
`specs/towers.md`.

The yard has **no fixed track**. The Load pathfinds across the open floor, and every
component and every blocker is a **wall**, so building lengthens the Load's route — but
movement is constrained by an **ordered chain of waypoints** each map defines, each a
4-tile **platform** you cannot build on: the Load must reach each waypoint in sequence,
and between consecutive waypoints it takes the **shortest open route around the walls you
have built**. A **never-seal rule** forbids fully blocking any segment of the chain or
encircling a waypoint, and the floor **re-paths live** whenever the maze changes. The
campaign is played on a **map you choose at the start**, and the three maps differ in
**topology** — different waypoint
placements, and one with pre-blocked transformer housings that pre-shape the maze
before you build a single wall (`specs/board.md`, `specs/modes.md`).

**You also produce the game's art, effects, and audio yourself.** Arc Foundry ships
with **no** pre-made sprites, effects, or sounds. The run image puts six
asset-generation tools on your `PATH`, and you must author every asset the game
plays — the component sprites across all five quality tiers, the enemy and boss
animations, and above all the **produced electrical particle VFX** (arcs, spark
showers, chain-lightning, discharge rings) that carry this build's presentation —
with those tools during this build. The full contract for what to produce and how to
wire it in is `specs/assets.md`; read it as carefully as the simulation specs,
because the produced electrical VFX are half of what this build is judged on.

## How the specification is organized

This specification is split across several files. Read **all** of them before you
start; they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: the pitch, the fiction, goals, hard requirements,
  free choices, the coordinate system, the stage layout, the palette and type, and
  the visual design.
- `specs/board.md` — the board: the tile grid and the uniform component footprint,
  the **waypoint pathing and mazing model** in full (ordered waypoints,
  shortest-open-route mazing, the diagonal rule, the never-seal rule, live
  re-pathing, and flyers), the **three maps** with their exact waypoint coordinates
  and the pre-blocked housings, placement legality, range and targeting geometry,
  and the status-bar and build-panel layout.
- `specs/enemies.md` — the **Load** roster: each unit type and its trait, the flyer
  that bypasses the maze, the Dynamo boss, the per-wave HP-scaling formula, and
  wave-composition guidance. **Read this carefully.**
- `specs/towers.md` — the **eight** base **component types** and their firing
  identities (including the **Choke**'s slow, the **Rectifier**'s burn, and the
  **non-firing Regulator**'s aura), the **combination towers** and the full ability
  vocabulary (slow, burn, crit, multishot, aura), the **quality ladder** and how damage
  and range scale by tier, the full stat tables, the Coil chain and Arc-Node splash
  specifics, targeting priorities and head rotation, and the projectile-carries-the-hit
  rule. **Read this carefully.**
- `specs/build.md` — the **scrap-press build loop**: the fixed 5-stamp allowance (placing
  is free) and the on-placement random type/quality roll odds, the **keep exactly one
  per level** rule and inert **blockers**, **immediate combining** (quality and recipe),
  **downgrading**, **combo upgrades**, and the **UPGRADE QUALITY** Refinement track.
- `specs/flow.md` — the economy (Charge, thin bounties, the small wave-clear bonus, **no
  interest**, the Charge sinks), Grid Integrity and leaks, the wave campaign and
  victory/overload, milestone waves and the Dynamo, the **post-final maze-rating boss**
  (the run's only score), the game state machine, the required menus, the HUD, and what is
  out of scope.
- `specs/modes.md` — the **difficulty** system as an in-game menu (Easy/Medium/Hard
  change only the wave count and enemy toughness; money and builds are constant),
  and the **map-select** and **difficulty-select** menu content and navigation.
- `specs/controls.md` — the fixed-timestep simulation and the mouse and keyboard
  controls: pulling the press and placing a rock (continuous placement; the roll is on
  drop), selecting a candidate/component, keep/combine/upgrade-quality and targeting
  controls, starting and sending waves, the speed toggle, in-place pause vs the Esc
  pause menu, and mute.
- `specs/assets.md` — the **asset-production contract**: every sprite, sheet,
  **particle system**, sound, and music track you must produce with the on-`PATH`
  tools, where each lands, and how each is wired into the build. The **electrical
  VFX** section is the centerpiece. **Read this carefully.**
- `specs/proof.md` — the proof-of-implementation captures the finished build must
  write.
- `specs/mode.md` — the campaign start this run plays and its main-menu entry.
  Implement the start it defines; the main menu lists that start, then `HOW TO
  PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: a fixed-step real-time simulation of the Load
pathfinding an ordered-waypoint maze (with 4-tile waypoint platforms) across three maps
with live re-pathing, a random scrap-press build with the place-and-reveal stamp, the
keep-one-per-level rule, inert blockers, immediate combining, downgrading, and an UPGRADE
QUALITY track over a five-rung quality ladder, eight base component types (plus
recipe-assembled, upgradeable combination towers) with automatic targeting and traveling
electrical projectiles, a scarce economy of Charge (no interest) and Grid Integrity,
an escalating wave campaign that ends in a Dynamo boss and a post-final maze-rating finale,
multiple game states and menus,
and a HUD
— **and** a full pass of producing the game's art, effects, and audio with the
on-`PATH` tools. Aim for a build a person would actually want to play — tense,
legible, and alive — not a tech demo.

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
- **Runs in the browser with no backend.** No server, accounts, database, or network
  calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a
  `package.json` at its root, buildable with **only Node.js and npm-installed
  dependencies** (no separately installed language toolchain). **Commit a
  `package-lock.json`**: the build is installed with `npm ci`, which requires that
  lockfile. Running `npm ci` and then `npm run build` must produce the complete
  static site, with no further manual step, into one of `dist/`, `build/`, or `out/`
  at the project root, with an `index.html` at the root of that directory as the
  entry point. That output directory must run correctly when served as-is from a
  static file server **at any base path, not only the server root** — when it is
  played back it is mounted under a per-run sub-path (a path like
  `/runs/<id>/build/`), so every URL the build requests must resolve relative to the
  page rather than the origin root. `specs/assets.md` states the loading rule in
  full (no root-absolute `/…` URLs; a relative bundler base such as Vite's `base:
  './'`); it governs the produced assets and the bundled JS/CSS alike. You choose
  the language, framework, bundler, and rendering approach behind this interface;
  only the `npm ci` and `npm run build` commands and where the build output lands
  are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development, how
  to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to the
requirements above. Plain TypeScript with Canvas 2D is entirely sufficient; a
framework is not required. Favor a clean, well-structured codebase over any
particular technology. **You design the exact visual identity of each component type
and quality tier, the enemy sprites, the electrical VFX, the yard art, and how the
board reads on screen** — there is no pixel-exact layout to reproduce, only the
grid, waypoint coordinates, footprints, stats, odds, and behavior the specs pin.
Wave composition and per-wave spawn timing are yours to design within the
progression `specs/enemies.md` and `specs/flow.md` set.

## Coordinate system and presentation

All positions, sizes, and ranges in this document are given in **logical pixels** on
a fixed **1280 x 720** stage (16:9). The origin `(0, 0)` is the **top-left**; `x`
increases to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the background color on the remaining space. The
  game must remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete `1280 x
  720` area is visible at once — the full board, the top status bar, the right build
  panel, and all four edges — fitted to the window and centered, with nothing
  clipped or pushed past the edges. The build must fit correctly on load, before any
  input, and at any pixel density.

The stage is divided into three regions (`specs/board.md` details each):

- a **top status bar** — `y` in `[0, 56]`, full width — with Charge, Grid Integrity,
  the wave indicator, and the global speed/pause/mute controls;
- the **right build panel** — `x` in `[1000, 1280]`, `y` in `[56, 720]` (280 px
  wide) — with the scrap-press control, the selected-component inspector, the
  next-wave preview, and the wave control;
- the **board (yard)** — `x` in `[0, 1000]`, `y` in `[56, 720]` (1000 x 664) — the
  chosen map's tile grid, waypoints, components/candidates/blockers, the Load,
  projectiles, and
  VFX.

The status bar and build panel are fixed and always fully visible; the board fills
the rest and is shown **whole**, with no scrolling camera.

## Visual design

The look is **electro-industrial**: a cold, oil-dark concrete substation yard lit by
the blue-white flash of discharging components — arcs, spark showers,
chain-lightning leaping between coils, and the fat crack of a discharge rig
unloading. The canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Deep field / void (background) | `#080a0d` |
| Yard substrate (board fill) | `#12161b` |
| Grid line (faint) | `#1d242c` |
| Fixed-blocked housing (Map C) | `#2b333c` |
| Feeder vent (Entry) | `#4ac6ff` |
| Grounding collector (sink) | `#ff5a52` |
| Flow-direction glow | `#3d7fa8` |
| Placement cue (valid spot) | `#2b4a3a` |
| Placement cue (invalid / would seal) | `#5a2b2b` |
| Charge (currency) | `#ffcf4a` |
| Grid Integrity (lives) | `#46d6e6` |
| Arc / discharge core (blue-white) | `#eaf6ff` |
| Capacitor (single bolt) | `#8fc4ff` |
| Coil (chain-lightning) | `#b98cff` |
| Emitter (rapid spark) | `#7fe0c0` |
| Arc-Node (area discharge) | `#ff9a46` |
| Discharge Rig (heavy bolt) | `#ff5470` |
| Choke (slow) | `#66d9e8` |
| Rectifier (burn) | `#ff6b3d` |
| Regulator (aura / support) | `#b6e05a` |
| Combination-tower accent | `#ffe9a8` |
| Quality — Scrap (T1) | `#7a8794` |
| Quality — Tuned (T2) | `#8fd0a0` |
| Quality — Charged (T3) | `#6cb6ff` |
| Quality — Primed (T4) | `#c78cff` |
| Quality — Tesla-Prime (T5) | `#ffe45a` |
| Blocker (inert scrap rock) | `#4a4640` |
| The Load (charge units) | `#c4cbd6` |
| Dynamo (overload core) | `#a45cff` |
| Alert / danger | `#ff5a52` |
| Panels / overlays | `#141a20` |
| Primary text | `#e8eef5` |
| Secondary text | `#93a2b2` |
| Tertiary text / hints | `#5d6b7a` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is required
  so the game renders identically offline.
- **The status and support VFX reuse the ability colors** (`specs/assets.md`): the
  **slow** snap uses the Choke blue `#66d9e8`, the **burn** damage-over-time uses the
  Rectifier orange `#ff6b3d`, and the **aura** pulse uses the Regulator green
  `#b6e05a`; a **combination tower** wears the gold accent `#ffe9a8` so it reads as
  distinct from a base component on the board.
- Keep the board legible: a player must be able to tell open yard from a wall, a
  legal placement spot from an illegal one, a waypoint from open floor, and the flow
  direction toward the collector, at a glance.
- **The quality ladder must read at a glance.** A component's **quality tier** is
  the power axis of the whole game, so it must be unmistakable on the board by
  **more than color alone** — the sprite finish and the firing VFX intensity
  escalate every rung, from a pitted, dim-flickering Scrap through a polished,
  humming Charged to a mirror-chromed Tesla-Prime wreathed in continuous arcs. A
  board full of Scrap must read as a junkyard and a Tesla-Prime as a lightning god.
  **Blockers must read as unmistakably inert** — a fused scrap rock with no firing head
  — and a **candidate** (a placed-but-not-yet-kept roll) must read as distinct from a
  kept component so the player can tell what is still selectable. Component **type** is
  coded distinctly from quality **tier** so the two axes never collide
  (`specs/towers.md`).
- **The produced electrical VFX are the headline of this build.** The arcs,
  chain-lightning, spark showers, and discharges are simulated `particle-2d` systems
  played live and spawned at each event, not canned frames or flat flashes, and they
  escalate with the firing component's quality tier so the ladder reads in the
  effects too (`specs/assets.md`). **Each component's firing head rotates to aim**
  at its target, and every shot is a **visible traveling projectile or arc that
  carries the hit** to the target on impact (`specs/towers.md`).
- **You produce the art, effects, and audio** with the on-`PATH` tools — see
  `specs/assets.md`, which is the contract for the sprites, animations, particle
  VFX, and audio, and how to load and wire each in. The HUD, build panel, menus,
  map-select previews, placement cues, range rings, the grid, and selection feedback
  all come from your code, in this palette.
- The canonical screens — the title screen, the live board, the **Overload**
  (defeat) screen, and the **Victory** screen — are described in full under Game
  states in `specs/flow.md`. Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative live-board frame, mid-wave.
- `reference/game-over.png` — the Overload screen.

Treat them as **illustrative examples, not targets to reproduce**: they show one way
the screens can look, but design your own menus, yard art, component and enemy
sprites, and layout rather than copy them. The only firm requirement is that every
menu and navigation path this specification mandates is present, rendered in the
palette and type the spec defines. They are images only — the exact maze, component
mix, quality tiers, and Load positions they show are just **one example moment**.
Build the screens from this specification, and lay out the pinned maps and stats
yourself.
