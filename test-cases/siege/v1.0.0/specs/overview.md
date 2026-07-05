# Siege

## Overview

**Siege** is a first-person, voxel **last-stand survival** shooter for the
browser. You are a Warden defending a chain of three fortified positions — the
**redoubts A, B, and C** — strung across a procedurally generated frontier, while
the **Scourge**, a red mechanized swarm, pours in from the far edge to overrun
them. You cannot win by holding: the assault only ever escalates. Every redoubt
falls in time, you fall back to the next, and when the last redoubt (C) is
overrun the siege is over. What you are playing for is **how long you survive**
and **how many attackers you destroy** before that happens.

You fight on foot in the first person as one of three **classes** with a
primary/secondary/grenade loadout — you choose your class when you spawn (and may
change it every time you respawn; see `specs/flow.md`) — aided by a four-Warden
**squad**: a rifleman, a machine gunner, a medic, and an engineer, who fight and
respawn alongside you. Healing comes **only** from your medic, and reserve-ammo
resupply **only** from your engineer. The Scourge escalates on two axes: as your
**kill count** climbs the same attackers spawn at tougher, up-armored **tiers** (a
quality ramp), and **between** redoubts each new phase brings a **new kind of
attacker** — while dedicated **breaker** sappers and arcing **artillery** grind
every redoubt down no matter how well you fight.

Siege is inspired by objective-defense and horde survival shooters but is its own
game, with an original name, factions, world, class roster, and enemy roster. Do
not reproduce the assets, branding, unit names, or exact design of any existing
game.

## How the specification is organized

This specification is split across several files. Read **every one** before you
start; they cross-reference each other **by name** and form a single spec.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, the game states, the rendering and
  performance requirements, and the reference index.
- `specs/world.md` — the arena: its dimensions, the procedurally generated
  terrain, the three redoubts and their placement, the enemy spawn lines, and
  where you respawn.
- `specs/phases.md` — the **survival loop**: the count-up clock, how a redoubt is
  ground down and lost, how the siege escalates through phases A → B → C, the
  enemy tiers, and win/loss.
- `specs/combat.md` — the three player **classes** and their weapons, projectile
  and hitscan behavior, grenades, and the **Scourge roster** with its tiers and
  armor.
- `specs/ai.md` — 3D **pathfinding**, the Scourge unit behaviors, and your
  **squad** (a rifleman, a machine gunner, a medic, and an engineer), including the
  medic healing and engineer resupply rules and the respawn timers.
- `specs/flow.md` — the game-state machine (the title screen, the in-game spawn UI,
  and the rest), controls, the **HUD** (including the performance overlay, the
  wireframe toggle, the squad panel, and artillery telegraphs), audio, and what is
  out of scope.
- the `standard` spec — the playable mode and its deploy-screen
  entry.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a large front-end task: a procedurally generated voxel world rendered in
real-time 3D, a first-person controller with pointer-lock aiming, several weapon
systems (hitscan, projectile, and arcing), two distinct AI systems (an escalating
enemy and a friendly squad) that both pathfind in 3D, a health-based objective and
respawn loop, and multiple game states. Aim for a build a person would actually
want to play, not a tech demo.

### Hard requirements

- **Renders real 3D graphics.** Draw the world with **WebGL or WebGPU** (a
  helper library such as a scene-graph or math library is fine). A text-only,
  ASCII, or purely-2D rendering does not satisfy this test case. Every block,
  structure, weapon, and character is **blocky voxel/box geometry you generate in
  code** — you are given **no** model, mesh, or texture files and must not fetch
  any at runtime. Flat or simply-shaded faces in the palette below are expected
  and acceptable; Scourge-style blocky models are the intended look.
- **Runs in the browser with no backend.** No server, accounts, database, or
  network calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **npm-driven static build.** The project must be a Node project with a
  `package.json` at its root, buildable with **only Node.js and npm-installed
  dependencies** (no separately installed language toolchain). **Commit a
  `package-lock.json`**: the build is installed with `npm ci`, which requires that
  lockfile. Running `npm ci` and then `npm run build` must produce the complete
  static site, with no further manual step, into one of `dist/`, `build/`, or
  `out/` at the project root, with an `index.html` at the root of that directory
  as the entry point. That output directory must run correctly when served as-is
  from a static file server, and **at any base path** — it is played back from a
  per-run sub-path, not only a server root, so any URL the build constructs at
  runtime must be **page-relative** (never begin with a leading `/`; for a
  bundler, set a relative base such as `base: './'`). You choose the language,
  framework, bundler, and rendering approach behind this interface; only the
  `npm ci` and `npm run build` commands and where the build output lands are
  fixed.
- **Self-contained rendering.** The game builds every mesh — terrain, structures,
  characters, weapons, projectiles, effects — itself, in code, in the palette
  below. It is **not** given art files and must not fetch any at runtime.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above. TypeScript with a thin WebGL layer or a lightweight 3D
library is entirely sufficient; a heavy engine is not required. Favor a clean,
well-structured codebase and a renderer that holds the required frame rate
(below) over any particular technology. Exact model designs are yours as long as
each reads as the silhouette its entry in the specs describes, in its faction
color and tier accent.

## Coordinate system and units

The world is a grid of unit cubes. **One world unit = one voxel edge.** All
positions, sizes, speeds, and ranges in this specification are in **world units**
unless stated otherwise; speeds are world units per second (`u/s`), times are in
seconds, and angles in degrees.

- The arena is an axis-aligned box (exact extents in `specs/world.md`). The origin
  `(0, 0, 0)` is a bottom corner. **`+X` is the advance/retreat axis**: the
  Scourge attacks from **low `X`** and pushes toward **high `X`**, and you fall
  back toward high `X`. **`+Y` is up.** **`Z` is the lateral (width) axis.**
- The simulation must be **frame-rate independent**, as a modern game is: movement,
  combat cadence, redoubt damage, and spawns advance in real time (scaled by the
  elapsed time between frames), never per rendered frame, so behavior is the same
  whether a machine draws fast or slow. Use whatever integration approach you like
  (a variable delta-time step, or a fixed-step accumulator under the hood) — the
  requirement is the observable one: the game plays the same at 30 FPS and at 120.
- The world is **procedurally generated with randomness** each match (the terrain
  and the spawns; see `specs/world.md` and `specs/phases.md`) — two matches should
  not lay out identically.

## Visual design

The look is a **war-torn green frontier under a pale sky**: rolling voxel terrain,
concrete-gray Warden redoubts flying blue banners, and a red Scourge tide. Two
factions are told apart by color — the **Wardens** (you and your squad) in
**Cobalt** blue, the **Scourge** in **Ember** red — and Scourge **tiers** are
told apart by an accent that plates over the same silhouette. The canonical
palette and type are below; match them.

| Element | Color |
| --- | --- |
| Sky (background) | `#8fb8d6` |
| Sky haze (horizon) | `#c2d6e4` |
| Terrain — grass top | `#5a8f3c` |
| Terrain — grass shadow | `#47702f` |
| Terrain — dirt / soil | `#6b4e34` |
| Terrain — rock / stone | `#6d6b66` |
| Terrain — rock dark | `#4c4a46` |
| Terrain — sand / path | `#b8a066` |
| Redoubt structure (concrete) | `#c8ccd2` |
| Redoubt structure (shadow) | `#9aa0a8` |
| Warden — Cobalt (you & squad) | `#3d7bd6` |
| Warden — Cobalt light (accent) | `#7fb0f0` |
| Medic — Teal (squad medic) | `#2fb59a` |
| Medic cross / heal accent | `#eafcf6` |
| Scourge — Ember (Tier I body) | `#b83a3a` |
| Scourge — Tier II plating (steel) | `#c9ced6` |
| Scourge — Tier III trim (elite) | `#ffcf4d` |
| Scourge — energy / eye | `#ff6a5a` |
| Health — healthy | `#5ec96b` |
| Health — critical | `#ff5c5a` |
| Ammo / accent | `#ffce54` |
| Artillery telegraph (warning) | `#ff7a3d` |
| Artillery telegraph (imminent) | `#ff3a2f` |
| Primary text | `#eef3f7` |
| Secondary text | `#9fb0c0` |
| Faint text / hints | `#6f8090` |
| Selection / valid | `#7fb0f0` |

- Use a **monospace** type family for all HUD text (health, ammo, timers, labels).
  Do not depend on a downloaded web font; a system monospace stack is required so
  the game renders identically offline.
- Wardens are drawn in Cobalt — the rifleman and machine gunner in plain Cobalt,
  the medic in Teal with the heal-accent cross, and the engineer marked in the
  ammo/accent color for its resupply role (`specs/ai.md`); the Scourge in Ember,
  with Tier II carrying steel **plating** and Tier III a bright elite **trim** over
  the same base silhouette (`specs/combat.md`).
- Structures and characters carry a **health bar** when damaged (healthy →
  critical color by fraction remaining), drawn just above them in the world; a
  redoubt's health is also shown on the HUD (`specs/flow.md`).

## Rendering and performance

This is a 3D voxel world, and it must run at an **interactive frame rate**, not
just render a still. These are hard requirements:

- **Frame rate.** On a mid-range laptop the game must sustain a **playable frame
  rate (target 30 FPS or better)** during a live phase-C assault with artillery
  falling — dozens of attackers, your squad, projectiles, and telegraphs on
  screen at once. This is a hard requirement on the finished build; how you
  organize the renderer to meet it is your choice. The **performance overlay**
  (`specs/flow.md`) must display the live FPS so this is observable.
- **Wireframe mode.** A toggle (`specs/flow.md`) must switch rendering to
  **wireframe** for both the terrain and the character/weapon geometry, so the
  underlying generated geometry is inspectable.
- **Pointer-lock aiming.** First-person look uses the browser Pointer Lock API
  (`specs/flow.md`); movement and look must be smooth and frame-rate independent.

## Game states

The build is a small state machine (defined fully in `specs/flow.md`): a
**title** screen (with **PLAY** and **HOW TO PLAY**), the **in-siege** game — in
which you pick your **class** on the spawn UI each time you deploy or respawn — a
**paused** overlay, and a **defeat** screen. Every state must be reachable and
behave as `specs/flow.md` describes. The title screen is what the game shows on
load.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look.
The gameplay reference is **HUD-only** — the mockups cannot fake the 3D world
convincingly, so the in-siege reference shows only the HUD overlay (its layout,
palette, and type) over a neutral viewport; you render the 3D world itself from
this specification.

- `reference/title.png` — the **title** screen shown on load: the `SIEGE` title
  and the **PLAY** and **HOW TO PLAY** options.
- `reference/gameplay.png` — the in-siege **HUD** over a neutral viewport: the
  crosshair and the full HUD (health, ammo, survival clock, kills, the active
  redoubt label and health bar, and the squad panel).
- `reference/game-over.png` — the defeat screen with the run's survival time and
  kill count.

Treat them as visual targets: match their layout, palette, and type. They are
images only — build the screens from this specification.
