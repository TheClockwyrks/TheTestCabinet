# Caldera

## Overview

**Caldera** is a real-time **strategy tower-defense** for the browser, fought over
a procedurally generated **hexagonal** volcanic basin rendered in real-time 3D.
You are the **Holdfast**, and you defend a single fixed **Core** at the heart of
the caldera against the **Slag** — an obsidian corruption that wells up from the
low breaches in the crater rim and grinds inward toward the Core in escalating
**waves**. Unlike a fighting retreat, this is a stand you can **win**: survive the
final wave and the caldera **holds**; let the Core fall and you are **overrun**.

You do not control a soldier. You command from a tilted, orbiting overhead camera,
spending **funds** to build a defense across the terrain: a fluid supply chain that
draws **water** from rivers and lakes, pipes it to **boilers** built on geothermal
**vents** to make **steam**, and pipes that steam to **towers** that only fire when
supplied. The terrain is not scenery — its **elevation**, **cliffs**, **rivers**,
and **vents** are the rules the whole game is played against.

Caldera is inspired by network-management and tower-defense games but is its own
game, with an original name, factions, world, and rosters. Do not reproduce the
assets, branding, unit names, or exact design of any existing game.

## How the specification is organized

This specification is split across several files. Read **every one** before you
start; they cross-reference each other **by name** and form a single spec.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  **hex coordinate system**, the palette and type, the game states, the rendering,
  camera, and performance requirements, and the reference index.
- `specs/world.md` — the caldera: the hex grid, elevation and terraces/cliffs,
  the procedurally generated terrain, the rivers, lakes, and geothermal vents, the
  two rim breaches, and the Core.
- `specs/build.md` — the **economy**: funds and the Core upgrade, every buildable
  structure and its placement rules on the terrain, and repair/demolish.
- `specs/fluids.md` — the **fluid network**: how water is drawn and pumped, how
  boilers convert it to steam, how steam powers towers, capacities and flow rates,
  the elevation-aware flow rules, brownouts, and severed lines.
- `specs/enemies.md` — the **Slag** roster (Runner, Breaker, Sapper, Colossus) with
  stats and tiers, and their **3D pathfinding**, targeting, and behaviors.
- `specs/towers.md` — the **Holdfast** tower roster (Repeater, Mortar, Lance,
  Scald) with stats, damage resolution, targeting, tower upgrades, and how
  elevation affects them.
- `specs/waves.md` — the **wave loop**: the discrete numbered waves, the
  curve-driven composition and tier escalation, wave cadence and caps, the score,
  and how the run is won or lost.
- `specs/flow.md` — the game-state machine (title, starting-wave prompt, in-game,
  paused, and the two end screens), the camera and build controls, the **HUD**
  (including the **fluid-network overlay**, the wireframe toggle, and the
  performance overlay), and what is out of scope.
- the `standard` spec — the playable mode and its title-screen entry.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a large front-end task: a procedurally generated **hex-mesh** world with
terraced elevation, carved rivers, and animated water, rendered in real-time 3D
from a tilted RTS camera; a two-fluid **flow-network simulation**; a build/economy
layer; **3D-pathfinding** enemy AI funneled by the terrain; a discrete escalating
wave loop with a win and a loss; and multiple game states. Aim for a build a
person would actually want to play, not a tech demo.

### Hard requirements

- **Renders real 3D graphics.** Draw the world with **WebGL or WebGPU** (a helper
  library such as a scene-graph or math library is fine). A text-only, ASCII, or
  purely-2D rendering does not satisfy this test case. Every hex tile, structure,
  pipe, tower, and Slag unit is **geometry you generate in code** — you are given
  **no** model, mesh, or texture files and must not fetch any at runtime. The
  terrain is a generated **triangle mesh**, not a flat image. Flat or
  simply-shaded faces in the palette below are expected and acceptable; a blocky,
  low-poly look is the intended style.
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
  `npm ci` and `npm run build` commands and where the build output lands are fixed.
- **Self-contained rendering.** The game builds every mesh — terrain, water,
  structures, pipes, towers, units, effects — itself, in code, in the palette
  below, using **procedural noise generated in code** for terrain surface
  variation. It is **not** given art or texture files and must not fetch any at
  runtime.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development, how
  to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above. TypeScript with a thin WebGL layer or a lightweight 3D
library is entirely sufficient; a heavy engine is not required. Favor a clean,
well-structured codebase and a renderer that holds the required frame rate (below)
over any particular technology. Exact structure and unit designs are yours as long
as each reads as the silhouette its entry in the specs describes, in its faction
color and tier accent, and the terrain reads as the coherent natural caldera the
world spec requires.

## Coordinate system and units

The world is a grid of **hexagonal cells** laid on a horizontal ground plane and
extruded upward by **elevation**. All positions, sizes, speeds, and ranges are in
**world units** unless stated otherwise; speeds are world units per second
(`u/s`), times are in seconds, and angles in degrees. **Fluid flow** is measured
in abstract **flow units per second (`f/s`)** defined in `specs/fluids.md`.

- **The hex grid.** The map is a rectangular grid of `W` columns by `H` rows of
  hexagonal cells (exact size in `specs/world.md`). Each interior cell has **six
  neighbors**. Use whichever hex layout and coordinate scheme you like (offset or
  axial; pointy-top or flat-top) — the requirement is a true, consistent hex
  tiling where every cell has six edges and six neighbors. A cell's **center** is
  its logical position; all gameplay (placement, pathing, targeting) resolves on
  cell centers and the true grid, **not** on the perturbed render vertices (see
  irregularity in `specs/world.md`).
- **Hexagon size.** A cell's outer radius (center to corner) is **`10` units**
  (tunable). One cell spans roughly `17` units across the flats.
- **Elevation is discrete.** Each cell has an integer **elevation level** in
  `0…8`. One level is a fixed **`3`-unit** vertical step (the *elevation step*), so
  terrain rises to about `24` units. Two adjacent cells are joined by their shared
  edge according to their level difference `d` (this is the heart of the terrain —
  full rules in `specs/world.md`):
  - `d = 0` — a **flat** edge, the two treads coplanar.
  - `d = 1` — a **terraced slope**: the single-level rise is broken into a small
    fixed number of stepped terrace treads with vertical risers between, not a
    smooth ramp.
  - `d ≥ 2` — a **cliff**: a vertical face with no terrace.
  Pipes and Slag traverse **flat** and **terraced** edges; a **cliff** edge is
  impassable to both.
- **`+Y` is up.** The horizontal plane carries the hex grid. `+Y` is elevation and
  the open air above the terrain.
- The simulation must be **frame-rate independent**: unit movement, fire cadence,
  fluid flow, funds income, and wave timing advance in real time (scaled by the
  elapsed time between frames), never per rendered frame, so behavior is the same
  whether a machine draws fast or slow. Use any integration approach you like — the
  requirement is observable: the game plays the same at 30 FPS and at 120, and at
  each supported game speed (`specs/flow.md`).
- The world is **procedurally generated with randomness** each match (the terrain,
  the vents, the water, and the breaches; see `specs/world.md`) — two matches
  should not lay out identically.

## Visual design

The look is a **war-scarred green caldera under a pale, ashen sky**: a terraced
hex basin of grass over rock, threaded by blue rivers and a lake, studded with
glowing geothermal vents, and defended by **brass** Holdfast works venting white
steam against a rising **obsidian** Slag tide. The two factions are told apart by
color — the **Holdfast** (your Core, pipes, and towers) in **brass** and steel,
the **Slag** in **obsidian** black with an **acid-green** glow — and Slag **tiers**
are told apart by an accent that plates over the same silhouette. The canonical
palette and type are below; match them.

| Element | Color |
| --- | --- |
| Sky (background) | `#9fb4bf` |
| Sky haze (horizon) | `#d8c8b0` |
| Terrain — grass top | `#6b9a44` |
| Terrain — grass shadow | `#517a34` |
| Terrain — dirt / soil | `#6b4e34` |
| Terrain — rock / andesite | `#5f5c58` |
| Terrain — rock dark / basalt | `#3a3836` |
| Terrain — scorched (near vents) | `#7a4a38` |
| Terrain — ash / path | `#b8a877` |
| Water — deep (lake / ocean) | `#2f6f8f` |
| Water — shallow (river) | `#4f97b0` |
| Water — foam / highlight | `#dbeef2` |
| Geothermal vent — glow | `#ff7a3d` |
| Geothermal vent — hot core | `#ffd08a` |
| Holdfast — brass (Core, towers) | `#c8a24a` |
| Holdfast — brass dark (shadow) | `#8a6d2e` |
| Holdfast — steel (accent) | `#b8bcc2` |
| Steam (vapor / powered) | `#dfeaea` |
| Pipe — water | `#3d9bd6` |
| Pipe — steam | `#7fcabc` |
| Slag — obsidian (Tier I body) | `#241f2b` |
| Slag — acid glow (energy / eye) | `#9ede3a` |
| Slag — Tier II plating (steel) | `#c9ced6` |
| Slag — Tier III trim (elite) | `#b56bff` |
| Health — healthy | `#5ec96b` |
| Health — critical | `#ff5c5a` |
| Funds / gold accent | `#ffce54` |
| Placement — valid | `#7fe0a0` |
| Placement — invalid | `#ff5c5a` |
| Alert / warning | `#ff7a3d` |
| Primary text | `#eef3f7` |
| Secondary text | `#9fb0c0` |
| Faint text / hints | `#6f8090` |

- Use a **monospace** type family for all HUD and menu text (funds, timers,
  labels, counts). Do not depend on a downloaded web font; a system monospace
  stack is required so the game renders identically offline.
- Holdfast works are drawn in **brass** and steel; **water pipes** are blue,
  **steam pipes** teal, and a powered tower vents white **steam**. The Slag are
  drawn in obsidian with an acid-green glow, Tier II carrying steel **plating** and
  Tier III a bright violet elite **trim** over the same base silhouette
  (`specs/enemies.md`).
- Structures and units carry a **health bar** when damaged (healthy → critical
  color by fraction remaining), drawn just above them in the world; the Core's
  health is also shown on the HUD (`specs/flow.md`).

## Rendering, camera, and performance

This is a 3D world, and it must run at an **interactive frame rate**, not just
render a still. These are hard requirements:

- **Tilted RTS camera.** The world is viewed through an overhead **strategy
  camera** looking down at the terrain at an angle — **not** a straight top-down
  view. The player can **pan**, **rotate** around the vertical axis, and **zoom**
  (`specs/flow.md`). The pitch must keep the terrain's relief legible: the tilt
  must clearly show that the world is **3D** — terraces stepping up, cliff faces,
  the depth of carved river channels, and the height of vents, towers, and units —
  and never flatten it into a top-down map. A straight top-down projection does
  **not** satisfy this case.
- **Frame rate.** On a mid-range laptop the game must sustain a **playable frame
  rate (target 30 FPS or better)** during a live late-wave assault — dozens of
  Slag pathing across the terrain, the full defense firing, steam and water flow,
  and effects on screen at once. This is a hard requirement on the finished build;
  how you organize the renderer to meet it is your choice. The **performance
  overlay** (`specs/flow.md`) must display the live FPS so this is observable.
- **Wireframe mode.** A toggle (`specs/flow.md`) must switch rendering to
  **wireframe** for both the terrain and the structure/unit geometry, so the
  underlying generated geometry — the hex mesh with its terraces and cliffs, and
  the built models — is inspectable.

## Game states

The build is a small state machine (defined fully in `specs/flow.md`): a **title**
screen (with **PLAY** and **HOW TO PLAY**), a **starting-wave** prompt reached from
PLAY, the **in-game** state (build and defend), a **paused** overlay, and two end
screens — **held** (victory) and **overrun** (defeat). Every state must be
reachable and behave as `specs/flow.md` describes. The title screen is what the
game shows on load.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look. The
gameplay reference is **HUD-only** — a flat mockup cannot fake the 3D world
convincingly, so the in-game reference shows only the HUD overlay (its layout,
palette, and type) over a neutral viewport; you render the 3D caldera itself from
this specification.

- `reference/title.png` — the **title** screen shown on load: the `CALDERA` title
  and the **PLAY** and **HOW TO PLAY** options.
- `reference/gameplay.png` — the in-game **HUD** over a neutral viewport: funds and
  income, the Core health, the wave counter and countdown, the steam supply
  readout, the build palette, and a selection panel.
- `reference/game-over.png` — an end screen with the run's result and stats.

Treat them as visual targets: match their layout, palette, and type. They are
images only — build the screens from this specification.
