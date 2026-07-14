# Valence

## Overview

**Valence** is a chemistry-themed **tower-defense** game for the browser. Unstable
**matter** streams out of an **inlet** and flows along a fixed **path** toward a
**collector**; you stop it by **freely placing** **towers** beside the path and breaking
the matter down before it escapes. Every unit that reaches the collector costs you
**integrity**; every unit you neutralize releases the **energy** that pays for more
towers.

The campaign is played on a **map you choose at the start** (`specs/board.md`,
`specs/flow.md`), and the maps differ in **topology** — an easy **single path**, a medium
**branching** fork of lanes, a hard set of **multiple separate paths** — and in **path
style** (some maps sweep as smooth **curves**, others run as straight lines with
**right-angle** corners). Towers are **placed freely**, Bloons-style: anywhere on the
board that is off the paths and not on another tower, not snapped to a grid.

Valence's defining idea is that matter is **hit points, damage types, and stackable
traits** — not a "pop a layer" ladder where each form has exactly one counter. Every
unit carries **electron shells** (its hit points), and any of three **damage types** —
**energy**, **kinetic**, **nuclear** — strips them. What differs is a unit's **traits**,
and a trait opens a unit to a **class** of towers, never just one:

- **Bonded** matter (a molecule) wraps its atoms in an outer **bond pool** — extra health
  **any** tower chips through, shedding a spray of free atoms as it breaks. Kinetic damage
  chews bonds fastest, but it is not the only opener.
- **Heavy** matter is a **radioactive isotope**, **immune to energy**; only **kinetic or
  nuclear** damage cracks it — several towers can, not one. As it is worn down it **decays**,
  shedding **alpha** and **beta** particles and transmuting into lighter isotopes.
- **Inert** matter is **untargetable until it is detected**, and detection comes from
  **several** sources (a support aura or an upgrade branch), not a single tower.

Traits **stack** late in the run — a heavy that is also inert, a cloaked molecule —
forcing **layered** defenses. Seven **general-purpose** towers each deal a damage type
and each choose one of two **upgrade branches**, so a board is a set of real choices.
Two are support **auras**: a **Catalyst** reveals and excites matter, a **Moderator**
slows it. You spend energy across an escalating **round campaign** that ends in a
fragmenting **boss**; survive every round and you win, run out of integrity and you
lose. It is inspired by lane-defense games but is entirely its own, with an original
name, an atomic-diagram look, the damage-type/trait model, and its own matter and
towers. Do not reproduce the assets, branding, characters, or exact design of any
existing game.

**You also produce the game's art, effects, and audio yourself.** Valence ships with
**no** pre-made sprites, effects, or sounds. The run image puts six asset-generation
tools on your `PATH`, and you must author every asset the game plays — the matter and
tower sprites, the orbiting-electron and boss animations, the decomposition particle
bursts, and the sound and music — with those tools during this build. The full contract
for what to produce and how to wire it in is `specs/assets.md`; read it as carefully as
the simulation specs.

## How the specification is organized

This specification is split across several files. Read **all** of them before you start;
they cross-reference each other by name and form one specification.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the stage layout, the palette and type, and the visual design.
- `specs/board.md` — the board: the **maps** the campaign offers (single-path, branching,
  and multiple-separate-path topologies, in curved or straight-and-right-angle styles),
  the **paths** matter travels (inlets, collectors, and how units are distributed across a
  map's paths), **free tower placement** (off the paths, no overlap — no grid), tower range
  and coverage, and the top status bar and right build panel.
- `specs/matter.md` — the matter: hit points, the three damage types, the three
  stackable traits (bonded, heavy, inert) and how they gate damage and detection, the
  matter types and their stats, and how a wave is built. **Read this carefully.**
- `specs/towers.md` — the seven towers (Emitter, Ionizer, Cleaver, Reactor, Beam,
  Catalyst, Moderator), their damage types, detection, the two-branch upgrade choice,
  and how you build, upgrade, and sell them.
- `specs/controls.md` — the mouse and keyboard controls: freely placing and selecting
  towers, upgrading and selling them, starting rounds, game speed, and pause.
- `specs/flow.md` — the economy, integrity, the round progression and victory, scoring,
  the game states, the required menus, the HUD, and what is out of scope.
- `specs/assets.md` — the **asset-production contract**: every asset you must produce
  with the on-`PATH` tools, where each lands, and how each is wired into the build.
  **Read this carefully.**
- `specs/proof.md` — the proof-of-implementation captures the finished build must write.
- `specs/mode.md` — the campaign start this run plays and its main-menu entry. Implement
  the start it defines; the main menu lists that start, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser. This is
a substantial front-end task: a fixed-step real-time simulation of matter flowing along a
chosen map's paths, free tower placement with automatic targeting, a hit-point /
damage-type / stackable-trait model with seven general-purpose towers and their two-branch
upgrades, an economy of energy, interest, and integrity, an escalating round campaign with
a fragmenting boss, multiple game states and menus, and a HUD — **and** a full pass of
producing the game's art, effects, and audio with the on-`PATH` tools. Aim for a build a
person would actually want to play — tense, legible, and alive — not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or positioned
  DOM elements. A text-only or ASCII rendering does not satisfy this requirement.
- **Produces its own assets.** Every sprite, animation, particle effect, and sound the
  game plays must be **produced during this build with the six tools on your `PATH`**
  (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music`), per
  `specs/assets.md`. Do not ship placeholder rectangles, ad-hoc code-drawn art in place
  of a sprite, downloaded assets, or silence.
- **Runs in the browser with no backend.** No server, accounts, database, or network
  calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a `package.json`
  at its root, buildable with **only Node.js and npm-installed dependencies** (no
  separately installed language toolchain). **Commit a `package-lock.json`**: the build
  is installed with `npm ci`, which requires that lockfile. Running `npm ci` and then
  `npm run build` must produce the complete static site, with no further manual step,
  into one of `dist/`, `build/`, or `out/` at the project root, with an `index.html` at
  the root of that directory as the entry point. That output directory must run correctly
  when served as-is from a static file server **at any base path, not only the server
  root** — when it is played back it is mounted under a per-run sub-path (a path like
  `/runs/<id>/build/`), so every URL the build requests must resolve relative to the page
  rather than the origin root. `specs/assets.md` states the loading rule in full (no
  root-absolute `/…` URLs; a relative bundler base such as Vite's `base: './'`); it
  governs the produced assets and the bundled JS/CSS alike. You choose the language,
  framework, bundler, and rendering approach behind this interface; only the `npm ci` and
  `npm run build` commands and where the build output lands are fixed.
- **Documentation.** Include a `README.md` in the produced repository explaining what the
  game is, how to install dependencies, how to run it in development, how to produce the
  static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to the
requirements above. Plain TypeScript with Canvas 2D is entirely sufficient; a framework
is not required. Favor a clean, well-structured codebase over any particular technology.
**You design the exact geometry of each map's paths** (within the required topologies and
path styles `specs/board.md` sets — single-path, branching, and multiple-separate-path
maps, with at least one curved and at least one straight/right-angle map), the free-placement
footprint and clearance, the exact visual design of the matter and towers, and how the
board reads on screen — there is no pixel-exact layout to reproduce, only the topologies,
stats, and behavior the specs pin.

## Coordinate system and presentation

All positions, sizes, and ranges in this document are given in **logical pixels** on a
fixed **1280 x 720** stage (16:9). The origin `(0, 0)` is the **top-left**; `x` increases
to the right and `y` increases downward.

- The stage scales uniformly to fit the browser window while preserving its 16:9 aspect
  ratio, letterboxed with the background color on the remaining space. The game must
  remain correct and centered at any window size.
- Game logic operates in logical-pixel space, independent of the rendered scale.
- **The whole stage must be on screen.** At every window size the complete `1280 x 720`
  area is visible at once — the full board, the top status bar, the right build panel,
  and all four edges — fitted to the window and centered, with nothing clipped or pushed
  past the edges. The build must fit correctly on load, before any input, and at any pixel
  density.

The stage is divided into three regions (`specs/board.md` details each):

- a **top status bar** — `y` in `[0, 56]`, full width — with energy, integrity, the round
  indicator, and the global speed/pause/mute controls;
- the **right build panel** — `x` in `[1000, 1280]`, `y` in `[56, 720]` — with the tower
  shop, the selected-tower inspector, the next-round preview, and the start/send control;
- the **board** — `x` in `[0, 1000]`, `y` in `[56, 720]` — the chosen map's paths and the
  freely-placed towers, the matter, projectiles, and effects.

The status bar and build panel are fixed and always fully visible; the board fills the
rest. The whole board is on screen at once — there is no scrolling camera.

## Visual design

The look is **a reactor seen as an atomic diagram in the dark**: glowing conduits and
particle matter against a cold, near-black substrate, lit by the tools that break the
matter apart. The canonical palette and type are below; match them.

| Element | Color |
| --- | --- |
| Deep field / void (background) | `#090d13` |
| Substrate (board fill) | `#10171f` |
| Path / track (conduit channel) | `#22303e` |
| Path flow glow (direction of travel) | `#3d6b8c` |
| Placement cue (valid spot) | `#2b3d4e` |
| Energy (currency) | `#ffcf4a` |
| Integrity (containment) | `#46d6e6` |
| Free atom — element I | `#7fe0a0` |
| Free atom — element II | `#6cb6ff` |
| Electron shells | `#eaf3ff` |
| Molecular bond | `#93a6ba` |
| Inert / noble matter | `#c4cbd6` |
| Heavy nucleus (radioactive) | `#c7e14a` |
| Boss macromass | `#a45cff` |
| Energy damage / Ionizer | `#4aa6ff` |
| Emitter (energy) | `#8fb9ff` |
| Kinetic damage / Cleaver | `#ff8646` |
| Nuclear damage / Reactor | `#ff5470` |
| Beam (energy lance) | `#c9f24a` |
| Catalyst (reveal / excite) | `#e267c8` |
| Moderator (damping) | `#46d6c2` |
| Alert / danger | `#ff5a52` |
| Panels / overlays | `#121821` |
| Primary text | `#e8eef5` |
| Secondary text | `#93a2b2` |
| Tertiary text / hints | `#5d6b7a` |

- Use a **monospace** type family for all text (title, menus, HUD, labels). Do not depend
  on a web font that must be downloaded; a system monospace stack is required so the game
  renders identically offline.
- Keep the board legible: a player must be able to tell a path from the substrate, a legal
  placement spot from an illegal one, and the direction matter is flowing, at a glance.
- **A unit's traits must be unmistakable, and readable by more than color alone.** What
  a unit asks of the board — chip its bonds, bring kinetic/nuclear, detect it — is the
  core read of the game (`specs/matter.md`), so the traits must be distinguishable by
  **shape** as well as color: a **free atom** as a nucleus with **two** visible electron
  shells whose electron count (up to `2` inner, up to `4` outer) is its hit points, a
  **bonded** cluster as two or more atoms joined by bond sticks (ball-and-stick) with a
  draining bond-integrity read, a **heavy** as a dense, tightly-bound **radioactive
  isotope** orb with a shimmer and its own hit-point read, and an
  **inert** unit as a sealed, shrouded orb that visibly snaps to a "revealed" state
  under a detector. Because **traits stack**, a unit may show more than one read at once
  (a shrouded heavy, a cloaked cluster). A player must tell these apart at speed, and
  the HUD/next-round preview names each type and what it needs in words
  (`specs/board.md`, `specs/flow.md`).
- **Each tower is color-coded** by its role, and **each shot is colored by its damage
  type** (energy blue, kinetic orange, nuclear red — the accents above), so a full board
  reads as which capability sits where and which damage is landing. **The damage towers
  turn to aim** — each head rotates to face what it is firing at, and every shot is a
  **visible projectile that carries the hit** to the target on impact
  (`specs/towers.md`, `specs/assets.md`).
- **You produce the art, effects, and audio** with the on-`PATH` tools — see
  `specs/assets.md`, which is the contract for the sprites, animations, particle bursts,
  and audio, and how to load and wire each in. The HUD, build panel, menus, placement
  cues, range previews, and selection feedback all come from your code, in this palette.
- The three canonical screens — the title screen, the live board, and the
  containment-failed screen — are described in full under Game states in `specs/flow.md`
  (with the victory screen). Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative live-board frame, mid-round.
- `reference/game-over.png` — the containment-failed screen.

Treat them as **illustrative examples, not targets to reproduce**: they show one way the
screens can look, but design your own menus, board geometry, and layout rather than copy
them. The only firm requirement is that every menu and navigation path this specification
mandates is present, rendered in the palette and type the spec defines. They are images
only — and the exact path shapes, tower placement, tower mix, and matter positions they
show are just **one example moment**. Build the screens from this specification, and
design your own conforming maps.
