# Sunfront

## Overview

**Sunfront** is a real-time **tug-of-war** for the browser, fought across a **3D**
desert battlefield seen through a tilted overhead command camera. Two rival
legions of solar-powered war automatons — the **Duneforged** — face each other
across a stretch of sand. You never command a single unit. Instead you spend a
steadily ticking income on **spawner structures** in your walled staging yard;
every **wave**, each spawner you own stamps out its unit, and those units march
across the sand toward the enemy base, fighting whatever they meet on the way.
Win by grinding a hole through the enemy line and levelling their base; lose if
they level yours.

Sunfront is a duel of **composition and economy**. Its defining tension is that
you cannot see what the enemy is building — a **fog of war** hides their staging
yard, so you read their strategy only from the units that crest the horizon, and
answer with counters of your own. Partway down each side of the field stands a
**Reliquary**, a fortified objective that, when destroyed, floods its destroyer
with resources but spawns a lone **Aegis** guardian to blunt the very push that
felled it.

Sunfront is inspired by lane-pushing "tug-of-war" custom strategy games but is
its own game, with an original name, faction, look, unit roster, and economy. Do
not reproduce the assets, branding, unit names, or exact design of any existing
game.

## How the specification is organized

This specification is split across several files. Read **every one** before you
start; they cross-reference each other **by name** and form a single spec.

- `specs/overview.md` — this file: goals, hard requirements, free choices, the
  coordinate system, the palette and type, the game states, the **rendering,
  camera, and performance** requirements, and the reference index.
- `specs/playfield.md` — the battlefield geometry: the lane, the two bases, the
  Reliquaries, the staging yard and its build grid, and the **fog of war**.
- `specs/economy.md` — income, the resource economy, and placing and upgrading
  spawner structures.
- `specs/units.md` — the **unit roster**: every unit's stats, the armor/attack
  **counter system** that makes composition matter, and how combat resolves.
- `specs/waves.md` — the wave clock, how spawners emit units each wave, unit
  movement and target acquisition, and the Reliquary objective.
- `specs/flow.md` — win and loss, the game-state machine, controls, the HUD, the
  AI opponent, and what is out of scope.
- the `standard` spec — the playable mode and its main-menu entry.

The main menu lists the playable mode, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: a real-time **3D** simulation of dozens of
units, a resource economy, a placement UI, fog of war, an AI opponent, several
unit types with a rock-paper-scissors combat model, a mid-map objective, and
multiple game states and menus. Aim for a build a person would actually enjoy
playing, not a tech demo.

### Hard requirements

- **Renders real 3D graphics.** Draw the world with **WebGL or WebGPU** (a helper
  library such as a scene-graph or math library is fine). A text-only, ASCII, or
  purely-2D rendering does not satisfy this test case. Every unit, structure, and
  piece of terrain is **blocky voxel/box geometry you generate in code** — you are
  given **no** model, mesh, or texture files and must not fetch any at runtime.
  Flat or simply-shaded faces in the palette below are expected and acceptable;
  the Duneforged read as blocky solar automatons and siege engines.
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
  at the root of any static file server, since it is deployed to static hosting
  exactly that way. You choose the language, framework, bundler, and rendering
  approach behind this interface; only the `npm ci` and `npm run build` commands
  and where the build output lands are fixed.
- **Self-contained rendering.** The game builds every mesh — terrain, structures,
  units, effects — itself, in code, in the palette below. It is **not** given art
  files and must not fetch any at runtime.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above. TypeScript with a thin WebGL layer or a lightweight 3D
library is entirely sufficient; a heavy engine is not required. Favor a clean,
well-structured codebase and a renderer that holds the required frame rate (below)
over any particular technology. Exact unit designs are yours as long as each unit
reads as the silhouette its entry in `specs/units.md` describes, in its team
color.

## Coordinate system and units

The battle is fought on a horizontal **ground plane**. All positions, sizes,
speeds, and ranges in this specification are given in **world units** unless
stated otherwise; speeds are world units per second (`u/s`), times are in seconds,
and angles in degrees.

- **Axes.** The battlefield is an axis-aligned footprint on the ground plane.
  **`+X` is the advance axis**: the player holds **low `X`** and pushes toward
  **high `X`**, the AI holds high `X` and pushes toward low `X`. **`Z` is the
  lateral (width) axis**, across which the lane and its ranks spread. **`+Y` is
  up** — units and structures have real height and stand on the ground plane. The
  origin `(0, 0)` on the ground plane is a corner; the intended footprint is
  **`1280` along `X`** by **`720` along `Z`**, and the exact zones, bases, lane,
  and staging yards are laid out on it in `specs/playfield.md`.
- The simulation must be **frame-rate independent**, as a modern game is:
  movement, combat cadence, income, and the wave clock advance in real time
  (scaled by the elapsed time between frames), never per rendered frame, so
  behavior is the same whether a machine draws fast or slow. The game plays the
  same at 30 FPS and at 120.
- Gameplay logic operates in world space, independent of the rendered camera and
  window scale.
- **The two sides mirror.** The player holds the **low-`X`** side; the AI holds
  the **high-`X`** side. Every position given for the player's side has a
  mirror-image counterpart on the AI's about the centerline `x = 640`.

## Visual design

The look is **sunlit desert war**: warm sand under a low sun, two legions told
apart by a single team color — the player's warm **Ember** amber, the enemy's
cool **Azure**. The canonical palette and type are defined below; match them.

| Element | Color |
| --- | --- |
| Sand field (background) | `#9c8452` |
| Sand shadow / lane banding | `#7a663d` |
| Rock and terrain detail | `#5a4a30` |
| Staging-yard panel | `#241a10` |
| Fog of war (unexplored) | `#150f08` |
| Player team — Ember | `#ff8a3d` |
| Player team — Ember light | `#ffc061` |
| Enemy team — Azure | `#46b4e0` |
| Enemy team — Azure light | `#8fd8f2` |
| Neutral structure / Reliquary | `#ecd58c` |
| Health bar — healthy | `#7ed957` |
| Health bar — critical | `#ff5c5a` |
| Primary text | `#f4ecd8` |
| Secondary text | `#c7b487` |
| Faint text / hints | `#8a7a58` |
| Selection / valid placement | `#ffc061` |
| Invalid placement | `#ff5c5a` |

- Use a **monospace** type family for all text (resource counts, menus, labels,
  timers). Do not depend on a web font that must be downloaded; a system
  monospace stack is required so the game renders identically offline.
- Units and structures are modelled in their owner's team color (Ember for the
  player, Azure for the enemy), with **dark rock-colored edges or trim** so they
  read against the sand. A unit's amber/azure **energy accent** (a core, visor,
  or eye) is in the team's *light* shade.
- Bases, Reliquaries, and structures each carry a **health bar** when damaged
  (healthy → critical color by fraction remaining), drawn just above them in the
  world.
- The three canonical menu screens — the title screen, the in-match view, and the
  match-over screen — are described in full under **Game states** in
  `specs/flow.md`. Implement each as described, in this palette and type.

## Rendering, camera, and performance

This is a 3D battlefield, and it must run at an **interactive frame rate**, not
just render a still. These are hard requirements:

- **Tilted overhead command camera.** The match is played through an elevated,
  **tilted overhead** camera that frames the whole front — both bases, the full
  lane, and the player's staging yard — at once, so the tug-of-war reads at a
  glance (controls in `specs/flow.md`). It must clearly convey a **3D** world: the
  height of the bases, Reliquaries, and structures, units standing on the ground,
  and air units flying above the line. A straight flat top-down projection does
  **not** satisfy this case.
- **The whole front stays framed.** At every window size the camera keeps the
  complete battlefield in view — both bases, the full lane, the staging yard, and
  every HUD element — fitted and legible, with nothing important pushed off
  screen, on load before any input and at any pixel density.
- **Frame rate.** On a mid-range laptop the game must sustain a **playable frame
  rate (target 30 FPS or better)** during a heavy late-match battle — dozens of
  units, both Reliquaries and an Aegis, and effects on screen at once. This is a
  hard requirement on the finished build; how you organize the renderer to meet it
  is your choice. The **performance overlay** (`specs/flow.md`) must display the
  live FPS so this is observable.
- **Wireframe mode.** A toggle (`specs/flow.md`) must switch rendering to
  **wireframe** for the units, structures, and terrain, so the underlying
  generated geometry is inspectable.

## Game states

The build is a small state machine (defined fully in `specs/flow.md`): a
**title / main menu**, a **how-to-play** screen, the **in-match** game, a
**paused** overlay, and a **match-over** screen. Every state must be reachable
and behave as `specs/flow.md` describes.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look. The
in-match reference is **HUD-only** — a flat mockup cannot fake the 3D battlefield
convincingly, so the gameplay reference shows only the HUD overlay (its layout,
palette, and type) over a neutral viewport; you render the 3D world itself from
this specification.

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — the in-match **HUD** over a neutral viewport: the sol
  and income readout, the wave number and countdown, both base health bars, the
  build palette, a selected-spawner panel, and the performance overlay.
- `reference/game-over.png` — the match-over screen.

Treat them as visual targets: match their layout, palette, and type. They are
images only — build the screens from this specification.
</content>
</invoke>
