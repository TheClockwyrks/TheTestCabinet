# Thunderhead

## Overview

**Thunderhead** is a real-time, combined-arms **fleet-command** game for the
browser, fought over a procedurally generated world of mountainous islands
drowned in an endless **cloud sea**. You command a fleet — sky-warships, aircraft,
and cloud-diving submersibles — of one of three rival powers, and you fight an
enemy fleet for command of the sky.

What sets the command apart is that you play at **two scales at once**. From a
tactical command view you order your whole fleet across the battlespace; at any
instant you can **drop into direct control of any single unit you own — and of
any weapon station aboard it** — fly a fighter, lay a battleship's guns, dive a
submersible, then pull back out to command again. The rest of your fleet fights on
under your standing orders while you are away. You win by destroying the enemy
**flagship**; if your own flagship falls, the battle is lost.

The three powers are **asymmetric** — different not only in look but in how their
ships fight, endure, and reinforce:

- the **Ironbound**, a low, industrial power of riveted iron and coal-smoke that
  fights with gunpowder and armor;
- the **Meridian**, a high, elegant power of seamless hulls and energy shields
  that fights with precision and speed;
- the **Geode**, a crystalline power that draws power from resonance and heals
  what it does not lose outright.

Their full identities, colors, and rosters are in `specs/factions.md` and
`specs/units.md`.

Thunderhead is inspired by combined-arms naval-command games but is its own game,
with an original name, powers, world, and rosters. Do not reproduce the assets,
branding, unit names, or exact design of any existing game.

## How the specification is organized

This specification is split across several files. Read **every one** before you
start; they cross-reference each other **by name** and form a single spec.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system and the three **altitude bands**, the palette and type, the
  game states, the rendering, camera, and performance requirements, and the
  reference index.
- `specs/world.md` — the battlespace: the procedurally generated mountainous
  terrain and floating islands, the **cloud sea** and the concealing **murk**
  beneath it, how terrain shapes sight and movement, the boundaries, the two
  deployment zones, and the generation guarantees.
- `specs/factions.md` — the three powers (**Ironbound**, **Meridian**,
  **Geode**): each one's identity, color, and the axis on which it is asymmetric.
- `specs/units.md` — the shared unit **archetypes**, each power's roster and its
  gaps, and the **possessable stations** aboard every unit.
- `specs/command.md` — the **tactical command layer** and fleet orders, the
  **possession** model (taking control of a unit, and of a station within it), and
  the cameras and views.
- `specs/combat.md` — weapon and damage resolution across the **surface**, **air**,
  and **murk** domains: gunnery, aircraft ordnance, torpedoes, anti-air, and the
  **damage model** (armor, shields, resonance regeneration, and battle damage).
- `specs/recon.md` — **detection** and the fog of war: sensors, sight and sensor
  range, and how the murk and the terrain conceal.
- `specs/battle.md` — the **match loop**: deployment, reinforcement and the
  economy, escalation, and how a battle is won or lost.
- `specs/flow.md` — the game-state machine, the controls, the **HUD** and its
  overlays (the performance overlay and the wireframe toggle), audio, and what is
  out of scope.
- `specs/assets.md` — the **provided unit models** and how the build must load and
  use them.
- `specs/proof.md` — the proof-of-implementation artifacts the build must capture.
- the mode spec under `specs/modes/` — the playable mode and its deploy-screen
  entry.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a large front-end task: a procedurally generated 3D world of mountainous
islands under an animated cloud sea; a fleet of ships, aircraft, and submersibles
you command from a tactical view **and** pilot directly, station by station; three
**asymmetric** powers with distinct rosters and mechanics; combat resolved across
three altitude domains with a real damage model; detection and a fog of war; a
reinforcement economy; and a battle with a win and a loss. Aim for a build a
person would actually want to play, not a tech demo.

### Hard requirements

- **Renders real 3D graphics.** Draw the world with **WebGL or WebGPU** (a helper
  library such as a scene-graph or math library is fine). A text-only, ASCII, or
  purely-2D rendering does not satisfy this test case. The **world** — the terrain,
  the floating islands, the cloud sea and murk, water, projectiles, tracer, and
  effects — is **geometry you generate in code**, using **procedural noise
  generated in code** for terrain surface variation; you are given **no** terrain
  or effect art and must not fetch any at runtime. The **unit models** (every ship,
  aircraft, and submersible) are **provided to you** as rigid 3D model files that
  you must **load and use** (`specs/assets.md`); those are the only art you are
  given, and you must not fetch any other at runtime.
- **Rigid models.** Every unit is a **rigid assembly**: a body plus rigid
  sub-parts — turrets that rotate, gun barrels that elevate, rotors and propellers
  that spin — that move only by turning or sliding on simple joints. There are **no
  character models** and **no skeletal or soft-body deformation** anywhere in the
  game; every moving part of a unit is a rigid piece articulating on a joint. The
  provided models are authored to this contract (`specs/assets.md`); drive their
  joints from the simulation.
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
  a static file server, and **at any base path** — it is played back from a per-run
  sub-path, not only a server root, so any URL the build constructs at runtime
  (including every URL it uses to **load the provided model files**) must be
  **page-relative**: never begin with a leading `/`; for a bundler, set a relative
  base such as `base: './'` (`specs/assets.md`). You choose the language,
  framework, bundler, and rendering approach behind this interface; only the
  `npm ci` and `npm run build` commands and where the build output lands are fixed.
- **Self-contained.** Everything the build does not generate in code, it loads from
  the **provided** model files; it fetches no art, fonts, data, or code from the
  network at runtime.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development, how
  to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to the
requirements above. TypeScript with a thin WebGL layer or a lightweight 3D library
is entirely sufficient; a heavy engine is not required. Favor a clean,
well-structured codebase and a renderer that holds the required frame rate (below)
over any particular technology. The design of the terrain and effects you generate
is yours, as long as it reads as the world the spec describes; the unit models are
provided, so their form is fixed, but how you pose, articulate, and render them is
yours.

## Coordinate system and units

The world is a continuous 3D space on a horizontal ground plane. All positions,
sizes, speeds, and ranges in this specification are in **world units** unless
stated otherwise; speeds are world units per second (`u/s`), turn and elevation
rates in degrees per second, times in seconds, and angles in degrees.

- **Axes.** The battlespace is an axis-aligned box. **`X` and `Z` span the
  horizontal ground plane**; **`+Y` is up** (altitude). The origin `(0, 0, 0)` is a
  bottom corner. Exact extents are in `specs/world.md`; the intended footprint is
  **`2048 × 2048`** across the ground plane and **`512`** tall, all tunable.
- **The cloud line.** A single reference altitude — the **cloud line**, at
  **`Y ≈ 200`** (tunable) — is the surface of the cloud sea, the world's "sea
  level." The full battlespace divides into three **altitude bands** around it,
  defined in `specs/world.md`:
  - the **open sky** above the cloud line — clear air where aircraft fly and
    surface ships cruise along the cloud-top;
  - the **murk** below the cloud line — dense, concealing cloud, the domain where
    submersibles dive and hide;
  - the **terrain** — the solid landform beneath, whose peaks and floating islands
    rise through the cloud line into the open sky.
  Which units use which band, and how they move between them, is in
  `specs/units.md` and `specs/command.md`.
- The simulation must be **frame-rate independent**, as a modern game is: movement,
  turn rates, weapon cadence, damage, flow of the economy, and reinforcement
  advance in real time (scaled by the elapsed time between frames), never per
  rendered frame, so behavior is the same whether a machine draws fast or slow. Use
  any integration approach you like — the requirement is observable: the game plays
  the same at 30 FPS and at 120, and at each supported game speed
  (`specs/flow.md`).
- The world is **procedurally generated with randomness** each match (the terrain,
  the floating islands, the cloud sea, and the deployment layout; see
  `specs/world.md`) — two matches should not lay out identically.

## Visual design

The look is a **cold, high war over a sea of cloud**: dark mountainous islands and
suspended crags breaking a bright, rolling cloud sea under a pale sky, with three
fleets told apart at a glance by material and color. A power's **allegiance** — is
this unit **yours** or the **enemy's** — is shown by an overlaid marker/outline
color (allied blue, hostile red) that is independent of which power it belongs to,
so a mirror match still reads clearly. The canonical palette and type are below;
match them.

| Element | Color |
| --- | --- |
| Sky (background) | `#93aec4` |
| Sky haze (horizon) | `#c6d2dc` |
| Cloud sea — surface | `#e6ebf0` |
| Cloud sea — foam / highlight | `#f5f8fb` |
| Murk — cloud (near) | `#8b95a1` |
| Murk — cloud (deep) | `#565e69` |
| Terrain — grass top | `#5e7d46` |
| Terrain — grass shadow | `#47612f` |
| Terrain — dirt / soil | `#6b4e34` |
| Terrain — rock / stone | `#6f6b64` |
| Terrain — rock dark / scarp | `#49463f` |
| Terrain — scree / cliff face | `#575049` |
| Terrain — snow (high peaks) | `#e8edf0` |
| Floating island — underside rock | `#3d372f` |
| Ironbound — iron | `#6b7178` |
| Ironbound — iron dark | `#464b52` |
| Ironbound — brass / rust accent | `#c07a2c` |
| Ironbound — coal smoke | `#2c2e33` |
| Meridian — pearl white | `#dbe3ea` |
| Meridian — silver | `#a7b2bd` |
| Meridian — cyan energy / shield | `#4fd4e0` |
| Meridian — deep cyan accent | `#1f6f7a` |
| Geode — amethyst | `#8a5cff` |
| Geode — crystal light | `#b79bff` |
| Geode — resonant magenta | `#ff5ce0` |
| Geode — crystal dark | `#3a2a5a` |
| Allied — marker / outline | `#4f9dff` |
| Hostile — marker / outline | `#ff5347` |
| Objective / neutral | `#ffce54` |
| Health — healthy | `#5ec96b` |
| Health — critical | `#ff5c5a` |
| Shield / energy | `#5fd0dc` |
| Selection / valid | `#7fe0a0` |
| Invalid / blocked | `#ff5c5a` |
| Alert / warning | `#ff7a3d` |
| Danger / imminent | `#ff3a2f` |
| Order / waypoint | `#7fb0f0` |
| Requisition / gold | `#ffce54` |
| Primary text | `#eef3f7` |
| Secondary text | `#9fb0c0` |
| Faint text / hints | `#6f8090` |

- Use a **monospace** type family for all HUD and menu text (readouts, timers,
  labels, counts). Do not depend on a downloaded web font; a system monospace stack
  is required so the game renders identically offline.
- Each power's units carry its material and color — Ironbound in iron and brass,
  Meridian in pearl-white and cyan, Geode in amethyst and resonant magenta
  (`specs/factions.md`) — with a **shield** shown in the energy color on units that
  carry one, and a Geode unit's resonance shown in its magenta glow
  (`specs/combat.md`).
- Every unit carries an **allegiance marker** in the allied or hostile color, and a
  **health bar** when damaged (healthy → critical color by fraction remaining),
  drawn with it in the world; the flagships' health is also shown on the HUD
  (`specs/flow.md`).

## Rendering, camera, and performance

This is a 3D world, and it must run at an **interactive frame rate**, not just
render a still. These are hard requirements:

- **Two camera scales.** The game is played through a **tactical command camera** —
  an elevated, orbiting view over the battlespace that the player can **pan**,
  **rotate** around the vertical axis, and **zoom** (`specs/command.md`) — and,
  when a unit or station is possessed, a **direct-control view** bound to that
  station (a pilot's view from a cockpit, a gunner's view down a turret, a
  commander's view from a bridge; `specs/command.md`). Both must clearly convey a
  **3D** world — the relief of the islands, the depth of the cloud sea, the
  altitude of ships and aircraft. The tactical camera is a tilted overhead view,
  **not** a flat top-down map; a straight top-down projection does not satisfy this
  case.
- **Frame rate.** On a mid-range laptop the game must sustain a **playable frame
  rate (target 30 FPS or better)** during a **large engagement** — both fleets in
  action, aircraft aloft, gunfire and ordnance in the air, the cloud sea and
  terrain drawn, and effects on screen at once. This is a hard requirement on the
  finished build; how you organize the renderer to meet it is your choice. The
  **performance overlay** (`specs/flow.md`) must display the live FPS so this is
  observable.
- **Wireframe mode.** A toggle (`specs/flow.md`) must switch rendering to
  **wireframe** for both the terrain and the unit models, so the underlying
  generated terrain and the provided model geometry are inspectable.
- **Aiming when possessed.** Direct control of a piloting or gunnery station uses
  smooth, frame-rate-independent mouse look/aim (`specs/command.md`).

## Game states

The build is a small state machine (defined fully in `specs/flow.md`): a **title**
screen (with **PLAY** and **HOW TO PLAY**), a **deploy** screen reached from PLAY
(choose your power and the battle setup), the **in-battle** state (command and
possess), a **paused** overlay, and two end screens — **victory** (the enemy
flagship destroyed) and **defeat** (your flagship lost). Every state must be
reachable and behave as `specs/flow.md` describes. The title screen is what the
game shows on load.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look. The
in-battle references are **HUD-only** — a flat mockup cannot fake the 3D world
convincingly, so they show only the HUD overlay (its layout, palette, and type)
over a neutral viewport; you render the 3D world itself from this specification.

- `reference/title.png` — the **title** screen shown on load: the `THUNDERHEAD`
  title and the **PLAY** and **HOW TO PLAY** options.
- `reference/tactical.png` — the in-battle **tactical HUD** over a neutral
  viewport: the fleet roster, the flagship health, the requisition and reinforcement
  readout, the selection and order panel, and the minimap/contacts.
- `reference/control.png` — the **direct-control HUD** over a neutral viewport: the
  possessed unit and station readout, its weapon and station status, and the
  station-switch indicator.
- `reference/game-over.png` — an end screen with the battle's result and stats.

Treat them as visual targets: match their layout, palette, and type. They are
images only — build the screens from this specification.
