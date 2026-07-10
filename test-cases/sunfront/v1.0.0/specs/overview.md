# Sunfront

## Overview

**Sunfront** is a real-time **tug-of-war** for the browser, rendered in **3D** through
a low oblique command camera you scroll across the field. Two rival legions of
solar-powered war automatons — the **Duneforged** — face each other across a
diagonal stretch of desert, their bases
in opposite corners. You never command a single unit. Instead you spend a steadily
ticking income on **spawner structures** and **Solar Extractors** in your walled
staging yard; every **wave**, each spawner you own stamps out its unit, and those
units march across the sand toward the enemy base, fighting whatever they meet on the
way.
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
- `specs/playfield.md` — the battlefield geometry: the diagonal lane, the two
  corner bases, the Reliquaries, the staging yards and their build grid, and the
  **fog of war**.
- `specs/assets.md` — the **provided models**: every unit and structure is given to
  you as a 3D model file to load, scale, tint, and animate (the only art you get).
- `specs/economy.md` — income, the resource economy, and placing and upgrading
  spawner structures and Solar Extractors.
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
units, a resource economy, a placement UI, fog of war, an AI opponent, several unit
types with a rock-paper-scissors combat model, a mid-map objective, and multiple game
states and menus. Aim for a build a person would actually enjoy playing, not a tech
demo.

### Hard requirements

- **Renders real 3D graphics.** Render the battlefield with **WebGL or WebGPU** (a
  helper library such as a scene-graph or math library is fine). A **Canvas 2D**,
  positioned-DOM, text-only, or ASCII battlefield does **not** satisfy this test
  case — the field, its units, and its structures are a real 3D scene viewed through
  a camera. (The **HUD and menus** may be a 2D overlay — HTML/DOM or 2D canvas — laid
  over the 3D view; only the battlefield must be 3D.)
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
  runtime (including every URL it uses to **load the provided model files** and
  `assets/models.json`) must be **page-relative**: never begin with a leading `/`;
  for a bundler, set a relative base such as `base: './'` (`specs/assets.md`). You
  choose the language, framework, bundler, and rendering approach behind this
  interface; only the `npm ci` and `npm run build` commands and where the build
  output lands are fixed.
- **Provided models, world in code.** Every **unit and structure** is **provided**
  to you as a 3D model file that you must **load and render** — you must **not**
  replace them with primitives of your own (`specs/assets.md`). Everything else — the
  sand arena, the staging yards, the fog, projectiles and effects, and all HUD/menu
  furniture — the game **generates in code**, in the palette below. Apart from the
  provided models, the game fetches **no** art, fonts, data, or code from the network
  at runtime.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above. TypeScript with a thin WebGL layer or a lightweight 3D
library is entirely sufficient; a heavy engine is not required. Favor a clean,
well-structured codebase over any particular technology. The **units and structures
are provided** as models, so their form is fixed (`specs/assets.md`); how you camera,
light, pose, animate, and tint them, and how you generate the arena, fog, and effects
around them, is yours — as long as it reads as the world these specs describe.

## Coordinate system and presentation

The **simulation runs on a logical horizontal ground plane** — a flat arena the
units move and fight across. All positions, sizes, speeds, and ranges in this
document are **logical units** on that plane (`specs/playfield.md` fixes its extent
and the two corner bases); speeds are logical units per second, times in seconds. The
plane is **rendered in 3D**: the provided models stand up off it, and a camera
views it at a low angle. Keeping the gameplay on a 2D ground plane while
rendering it in 3D is deliberate — the combat numbers are planar; the third dimension
is presentation (model height, the camera, the Sunhawk's flight altitude).

- **The presentation is a fixed 16:9 view.** The rendered view preserves a **16:9**
  aspect ratio, scaled uniformly to fit the browser window and letterboxed with the
  background color on the remaining space. It must remain correct and centered at any
  window size and pixel density.
- Gameplay logic operates in logical ground-plane units, independent of the rendered
  scale or camera.
- The simulation must be **frame-rate independent**, as a modern game is: movement,
  combat cadence, income, and the wave clock advance in real time (scaled by elapsed
  time between frames), never per rendered frame, so behavior is the same whether a
  machine draws fast or slow.
- **The viewport fits the window; the world does not.** At every window size and pixel
  density the rendered **16:9** view fills the browser window (letterboxed on the
  remainder) and every HUD element stays on screen — fitted, centered, and correct on
  load before any input. But the camera frames only a **portion** of the arena at a
  time (see the camera section): the complete arena is deliberately **not** on screen
  at once — the player pans to see the rest.
- **The two sides mirror.** The player holds **one corner**; the AI holds the
  **opposite** corner. The layout has **180° rotational symmetry about the arena
  center**: every position and distance given for the player's side has a mirror-image
  counterpart on the enemy's side through the center point (`specs/playfield.md`).

## Rendering, Camera, and Performance

This is a 3D battlefield, and it must run at an **interactive frame rate**, not
just render a still. These are hard requirements:

- **Low oblique command camera.** Show the battlefield through a **perspective** camera
  at a fixed steep-but-angled pitch and a fixed yaw and zoom — a low overhead command
  view, not a flat top-down map — so model height, formation depth, and the front read,
  with the ground receding into the distance.
- **A limited, scrolling view.** The camera frames only a **portion** of the arena; the
  player **pans** it across the ground plane to reach other areas (`specs/flow.md`), and
  the whole arena is never in frame at once. Panning is the only required navigation —
  **no zoom control is required**, and none is needed to see the play described below.
- **The full lane width is always framed.** By default, and at every window size, the
  view spans the **entire width of the ~480-unit combat corridor** (`specs/playfield.md`)
  — the player never zooms out or pans sideways to see the whole width of the lane.
  Panning runs **along the corridor's length** (the diagonal, toward or away from the
  enemy), and the default view on load is centered on the **player's own corner**.
- **Frame rate.** On a mid-range laptop the game must sustain a **playable frame rate
  (target 30 FPS or better)** during a heavy late-match battle — dozens of units, both
  Reliquaries and an Aegis, and effects on screen at once. The **performance overlay**
  (`specs/flow.md`) must display the live FPS so this is observable.
- **Wireframe mode.** A toggle (`specs/flow.md`) must switch rendering to
  **wireframe** for units, structures, terrain, and generated effects, so the
  underlying 3D geometry is inspectable. Provided models may use a mesh wireframe
  material or an equivalent inspection material.

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
- Units and structures use their **provided models** (`specs/assets.md`), **tinted
  to their owner's team color** (Ember for the player, Azure for the enemy) so the two
  legions read apart at a glance, with the team **energy accent** (a core, visor, or
  eye) in the team's *light* shade. Light the scene and keep enough contrast against
  the sand that the models read clearly; the neutral Reliquary keeps its own color
  with the owner's accent.
- Bases, Reliquaries, and structures each carry a **health bar** when damaged
  (healthy → critical color by fraction remaining), drawn as a **billboard just above
  them** that faces the camera.
- The three canonical menu screens — the title screen, the in-match view, and the
  match-over screen — are described in full under **Game states** in
  `specs/flow.md`. Implement each as described, in this palette and type.

## Game states

The build is a small state machine (defined fully in `specs/flow.md`): a
**title / main menu**, a **how-to-play** screen, the **in-match** game, a
**paused** overlay, and a **match-over** screen. Every state must be reachable
and behave as `specs/flow.md` describes.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look. The
in-match reference is **HUD-only** — a flat mockup cannot fake the 3D battlefield
convincingly, so the gameplay reference shows the HUD overlay (its layout, palette,
and type) over a neutral viewport; you render the 3D world itself from this
specification.

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — the in-match **HUD** over a neutral viewport: the sol
  and income readout, the wave number and countdown, both base health bars, the build
  palette, a selected-structure panel, and the performance overlay.
- `reference/game-over.png` — the match-over screen.

Treat them as **illustrative examples, not targets to reproduce**: they show
one way the screens can look, but design your own menus and layout rather than
copy them. The only firm requirement is that every menu and navigation path
this specification mandates is present, rendered in the palette and type the
spec defines. They are images only — build the screens from this specification.
</content>
</invoke>
