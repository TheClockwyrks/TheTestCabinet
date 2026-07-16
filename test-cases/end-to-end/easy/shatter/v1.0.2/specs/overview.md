# Shatter

## Overview

**Shatter** is a neon, top-down space-rock shooter for the browser. You pilot a
small ship adrift in a single square of deep space, turning and thrusting under
pure momentum while jagged rocks drift and tumble around you. Firing splits a
large rock into smaller ones, and the smaller ones into smaller ones still, until
the last fragments wink out. Clear the field and a new, denser wave arrives; an
enemy saucer wanders in to hunt you.

Shatter's defining feature is the **gravity well**: a star fixed at the center of
the field pulls on everything that flies ballistically — every bullet and every
rock. Your ship and the enemy saucer are powered craft that fly free of the pull,
so the star never wrests the ship out of your hands; instead it **shapes the
board**. Shots bend as they cross the center, so you can curve a bullet around the
star to strike a rock on its far side, and rocks travel on curved, wrapping paths
that keep the whole field churning. The core is solid — the ship slides along it
rather than through it — and any rock the star swallows reappears from the edge
of the field, so the well stirs the board without ever emptying it.

Shatter is inspired by classic asteroid-shooting arcade games but is its own game,
with an original name, look, and its central **gravity-well** mechanic. Do not
reproduce the assets, branding, or exact design of any existing game.

## How the specification is organized

This specification is split across several files:

- `specs/overview.md` — this file: the overview, goals, hard requirements, free
  choices, coordinate system, and visual design.
- `specs/playfield.md` — the field and screen-wrap, the star, the ship, the
  rocks, the bullets, and the saucer, with their exact geometry.
- `specs/physics.md` — the simulation loop, inertial flight, the gravity well
  (the signature mechanic), and every collision rule.
- `specs/flow.md` — scoring, lives, waves, the saucer's behavior, the game
  states, controls, audio, the HUD, key behaviors, and what is out of scope.
- `specs/mode.md` — the mode ruleset for this build: how rocks take damage and
  which weapons the ship carries.

Read every spec file and implement the single game they describe as one cohesive
build. The specs cross-reference each other by name; treat them as one document.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: real-time rendered vector graphics, an
inertial physics loop with a gravity field acting on many bodies at once,
splitting rocks, escalating waves, an enemy that hunts and shoots, lives and
respawns, and several game states and menus. Aim for a build a person would
actually enjoy playing, not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this
  requirement.
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
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above — including the npm-driven static build, which fixes the
`npm ci` and `npm run build` commands and where the output lands, but not how you
implement the build behind them. Plain TypeScript with Canvas 2D is entirely
sufficient; a framework is not required. Favor a clean, well-structured codebase
over any particular technology.

## Coordinate system and presentation

All positions, sizes, and speeds in this document are given in **logical pixels**
on a fixed **1280 x 720** play area (16:9). The origin `(0, 0)` is the
**top-left**; `x` increases to the right and `y` increases downward. Angles are
measured clockwise from the positive `x`-axis (pointing right), in degrees unless
stated otherwise.

- The play area scales uniformly to fit the browser window while preserving its
  16:9 aspect ratio, letterboxed with the background color on the remaining space.
  The game must remain correct and centered at any window size.
- Gameplay logic operates in logical-pixel space, independent of the rendered
  scale.
- **The whole field must be on screen.** At every window size the complete
  `1280 x 720` area is visible at once — the ship, the star, every rock, the HUD,
  and every menu item, out to all four edges — fitted to the window and centered,
  with nothing clipped or pushed past the edges. The build must fit correctly on
  load, before any input, and at any pixel density.
- **The field wraps.** The left and right edges are joined, and the top and
  bottom edges are joined, so the play area is a seamless torus: a body leaving
  one edge reappears at the opposite edge with the same velocity. This wrap is
  defined precisely in `specs/playfield.md` and applies to the ship, bullets,
  rocks, and the saucer.

## Visual design

The look is neon-on-charcoal: bright vector outlines and glows over near-black
deep space. The canonical palette and type are defined below; match them.

| Element                     | Color     |
| --------------------------- | --------- |
| Field background            | `#060910` |
| Ship                        | `#6cf0ff` |
| Thrust flame                | `#ffd166` |
| Bullets                     | `#f2f5f7` |
| Rocks                       | `#9aa7bd` |
| Star core                   | `#ffd27a` |
| Star halo / gravity glow    | `#ff7b3d` |
| Saucer                      | `#ff5c8a` |
| Primary text                | `#e6edf3` |
| Secondary text              | `#8a94a6` |
| Faint text / hints          | `#4a5567` |

- Use a **monospace** type family for all text (score, menus, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is
  required so the game renders identically offline.
- The ship, bullets, rocks, star, and saucer have a soft neon glow. Rocks are
  drawn as irregular, angular polygon outlines (not smooth circles), so they read
  as tumbling debris; their collision shape is still the circle defined in
  `specs/playfield.md`.
- **Bullets leave a tapering motion trail (required).** Each moving bullet draws a
  continuous, fading comet along its recent path, so the way the star bends a shot
  reads at a glance; the full requirement is in `specs/playfield.md`.
- **The star reads as a gravity well.** Draw it as a bright core with a larger,
  softer radial halo fading outward into the field, so a player can see the region
  of strongest pull. Its exact size and the pull it exerts are in
  `specs/playfield.md` and `specs/physics.md`.
- The three canonical screens — the title screen, the in-game view, and the
  game-over screen — are described in full under Game States in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-game frame.
- `reference/game-over.png` — the game-over screen.

Treat them as **illustrative examples, not targets to reproduce**: they show one
way the screens can look, but design your own menus and layout rather than copy
them. The only firm requirement is that every menu and navigation path this
specification mandates is present, rendered in the palette and type the spec
defines. They are images only — build the screens from this specification.
