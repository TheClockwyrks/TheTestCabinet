# Sunfront

## Overview

**Sunfront** is a top-down, real-time **tug-of-war** for the browser. Two rival
legions of solar-powered war automatons — the **Duneforged** — face each other
across a stretch of desert. You never command a single unit. Instead you spend a
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
  coordinate system, the palette and type, the game states, and the reference
  index.
- `specs/playfield.md` — the battlefield geometry: the lane, the two bases, the
  Reliquaries, the staging yard and its build grid, and the **fog of war**.
- `specs/economy.md` — income, the resource economy, and placing and upgrading
  spawner structures.
- `specs/units.md` — the **unit roster**: every unit's stats, the armor/attack
  **counter system** that makes composition matter, and how combat resolves.
- `specs/waves.md` — the wave clock, how spawners emit units each wave, unit
  movement and target acquisition, and the Reliquary objective.
- `specs/flow.md` — win and loss, the game-state machine, controls, the HUD, the
  AI opponent, audio, and what is out of scope.
- the mode spec(s) under `specs/modes/` — the playable modes. Each mode spec
  declares its own main-menu entry.

The main menu lists the modes the mode specs define, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: a real-time simulation of dozens of units,
a resource economy, a placement UI, fog of war, an AI opponent, several unit
types with a rock-paper-scissors combat model, a mid-map objective, and multiple
game states and menus. Aim for a build a person would actually enjoy playing, not
a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this
  test case.
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
- **Self-contained rendering.** The game draws every unit, structure, and piece
  of terrain itself, in code, in the palette below — it is **not** given sprite
  or model files and must not fetch any at runtime.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above. Plain TypeScript with Canvas 2D is entirely sufficient;
a framework is not required. Favor a clean, well-structured codebase over any
particular technology. Exact unit artwork is yours to design as long as each unit
reads as the silhouette its entry in `specs/units.md` describes, in its team
color.

## Coordinate system and presentation

All positions, sizes, speeds, and ranges in this document are given in **logical
pixels** on a fixed **1280 x 720** play area (16:9). The origin `(0, 0)` is the
**top-left**; `x` increases to the right and `y` increases downward. Distances
and ranges are in logical pixels; speeds are in logical pixels per second
(`px/s`); times are in seconds.

- The play area scales uniformly to fit the browser window while preserving its
  16:9 aspect ratio, letterboxed with the background color on the remaining
  space. The game must remain correct and centered at any window size.
- Gameplay logic operates in logical-pixel space, independent of the rendered
  scale.
- **The whole field must be on screen.** At every window size the complete
  `1280 x 720` area is visible at once — both bases, the full lane, the staging
  yard, every HUD element, and all four edges — fitted to the window and
  centered, with nothing clipped or pushed past the edges. The build must fit
  correctly on load, before any input, and at any pixel density.
- **The two sides mirror.** The player holds the **left**; the AI holds the
  **right**. Every distance given for the left side has a mirror-image
  counterpart on the right about the vertical centerline `x = 640`.

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
- Units and structures are drawn in their owner's team color (Ember for the
  player, Azure for the enemy), each with a **dark outline** (use the rock color)
  so they read against the sand. A unit's amber/azure **energy accent** (a core,
  visor, or eye) is drawn in the team's *light* shade.
- Bases, Reliquaries, and structures each carry a **health bar** when damaged
  (healthy → critical color by fraction remaining), drawn just above them.
- The three canonical menu screens — the title screen, the in-match view, and the
  match-over screen — are described in full under **Game states** in
  `specs/flow.md`. Implement each as described, in this palette and type.

## Game states

The build is a small state machine (defined fully in `specs/flow.md`): a
**title / main menu**, a **how-to-play** screen, the **in-match** game, a
**paused** overlay, and a **match-over** screen. Every state must be reachable
and behave as `specs/flow.md` describes.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-match frame: the lane mid-battle,
  the staging yard with placed spawners, the HUD, and the fog over the enemy
  yard.
- `reference/game-over.png` — the match-over screen.

Treat them as visual targets: match their layout, palette, and type. They are
images only — build the screens from this specification.
</content>
</invoke>
