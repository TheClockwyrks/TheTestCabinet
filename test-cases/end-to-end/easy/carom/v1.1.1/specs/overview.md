# Carom

## Overview

**Carom** is a neon, top-down paddle duel for the browser. Two paddles face each
other across a dark field; a ball ricochets between them, off the top and bottom
walls, and off a pair of fixed obstacles in the middle of the field. A player
scores when the ball passes the far edge behind their opponent's paddle.

Carom is a duel of angles. Its defining mechanic is **spin**: the motion of a
paddle at the moment it strikes the ball curves the ball's flight afterward, so
skilled play is about shaping the ball's path, not just blocking it. The fixed
obstacles turn the field into a bank-shot puzzle.

Carom is inspired by classic paddle-and-ball arcade games but is its own game,
with an original name, look, spin mechanic, and obstacle layout. Do not
reproduce the assets, branding, or exact design of any existing game.

## How the specification is organized

This specification is split across several files:

- `specs/overview.md` — this file: the overview, goals, hard requirements, free
  choices, coordinate system, and visual design.
- `specs/playfield.md` — the playfield, paddles, obstacles, and ball.
- `specs/physics.md` — the physics loop, collision, and the paddle bounce and
  spin mechanic.
- `specs/obstacles.md` — how the obstacles behave and how the ball collides with
  them.
- `specs/balls.md` — how many balls are in play, where they spawn, how they are
  served, and how a point resolves.
- `specs/flow.md` — scoring and match flow, game states, controls, audio, the
  HUD, key behaviors, and what is out of scope.
- `specs/modes.md` — the two ways to play (Solo and Versus) and the AI opponent.

Read every one of these files and build the game they describe as one cohesive
whole. They cross-reference each other by name — treat them as a single
specification. The main menu lists `SOLO` and `VERSUS`, then `HOW TO PLAY`.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: real-time rendered graphics, a physics
loop, multiple game states and menus, an AI opponent, and a local two-player
mode. Aim for a build a person would actually enjoy playing, not a tech demo.

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

All positions, sizes, and speeds in this document are given in **logical
pixels** on a fixed **1280 x 720** play area (16:9). The origin `(0, 0)` is
the **top-left**; `x` increases to the right and `y` increases downward.

- The play area scales uniformly to fit the browser window while preserving its
  16:9 aspect ratio, letterboxed with the background color on the remaining
  space. The game must remain correct and centered at any window size.
- Gameplay logic operates in logical-pixel space, independent of the rendered
  scale.
- **The whole field must be on screen.** At every window size the complete
  `1280 x 720` area is visible at once — both paddles, the score, every menu
  item, and all four edges — fitted to the window and centered, with nothing
  clipped or pushed past the edges. The build must fit correctly on load, before
  any input, and at any pixel density.

## Visual design

The look is neon-on-charcoal. The canonical palette and type are defined below;
match them.

| Element                | Color     |
| ---------------------- | --------- |
| Field background       | `#0b0e14` |
| Player one paddle      | `#3ae7c4` |
| Player two / AI paddle | `#ff5c8a` |
| Ball                   | `#f2f5f7` |
| Obstacles              | `#ffb454` |
| Center net             | `#243044` |
| Primary text           | `#e6edf3` |
| Secondary text         | `#8a94a6` |

- Use a **monospace** type family for all text (scores, menus, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is
  required so the game renders identically offline.
- Paddles, the ball, and obstacles have a soft neon glow. The center net is a
  dashed vertical line at `x = 640`.
- **The ball leaves a motion trail (required).** Behind the moving ball, draw a
  fading tail that traces its **recent path**, so it visibly curves whenever
  spin curves the flight (see the spin mechanic in `specs/physics.md`). It must
  read as one **continuous** streak — a smooth comet, not a row of discrete dots
  — that **tapers** from the ball: widest and brightest where it meets the ball,
  then narrowing and fading smoothly to nothing at its oldest end. The trail
  represents a **fixed slice of recent travel time** (on the order of `0.1`–`0.15
  s` of motion), so its length is proportional to the ball's current speed: it
  stretches as the ball speeds up and shortens as it slows, collapsing to almost
  nothing during the pre-serve hold while the ball is still. Use the ball color;
  the trail is what makes the ball's speed and spin legible in motion. Match
  `reference/gameplay.png`.
- The three canonical screens — the title screen, the in-match view, and the
  match-over screen — are described in full under Game States in `specs/flow.md`.
  Implement each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-match frame.
- `reference/game-over.png` — the match-over screen.

Treat them as **illustrative examples, not targets to reproduce**: they show one
way the screens can look, but design your own menus and layout rather than copy
them. The only firm requirement is that every menu and navigation path this
specification mandates is present, rendered in the palette and type the spec
defines. They are images only — build the screens from this specification.
