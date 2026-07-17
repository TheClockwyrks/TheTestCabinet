# Carom — Debug and automation API

Carom ships a small **debugging and automation surface** so the game can be
driven and inspected from code — without touching the keyboard or waiting on real
time. It is what you use to iterate on the physics, reproduce a specific rally,
and write automated checks of the mechanics; it is also handy for capturing clean
screenshots of an exact game state. This file defines that surface. Implement all
of it — it is a required part of the build, on the same footing as the game
itself.

Nothing here changes how a person plays: the debug API is inert during normal
play (it does nothing until something calls it), and the debug overlay is off
until toggled.

## A deterministic core

The whole surface rests on the simulation being **deterministic and steppable**,
which the physics loop in `specs/physics.md` already requires: a **fixed
timestep**, integrated in whole steps, decoupled from rendering. Two more
properties make it driveable from code:

- **Render-free core.** Game state advances by stepping the simulation; it must
  not depend on a canvas, on `requestAnimationFrame`, or on wall-clock time to
  make progress. Rendering reads the state, never the other way around.
- **Seeded randomness.** Any randomness the game uses (for example a random serve
  or launch angle) must run off a **seedable** generator, so that reseeding and
  replaying the same calls reproduces the same result exactly. A build with no
  randomness satisfies this trivially.

Given the same seed and the same sequence of API calls and steps, the game must
reach the same state every time.

## The `window.__carom` object

Expose the API as a single object on the global `window.__carom`, installed once
the game is running. It carries a `version` number (use `1`) and the operations
below. Values are plain numbers, strings, and booleans so a caller can read them
directly; coordinates and velocities are in the logical-pixel space of
`specs/overview.md`.

### Core operations

- **`reset(options)`** — return the game to its initial title state. `options` is
  optional; `options.seed` (a number) seeds all of the game's randomness so a
  scenario replays identically. After `reset`, the keyboard and (in Solo) the AI
  resume control of the paddles until a control operation below takes over again.
- **`step(seconds)`** — advance the simulation by `seconds` of game time,
  **immediately**, running the fixed-timestep update internally (rounded to a
  whole number of fixed steps) rather than waiting for real frames. This is how a
  caller runs the real physics forward from a set-up state and sees where it
  lands. Stepping only advances the live field (a rally or its countdown); it has
  no effect on a menu screen.
- **`snapshot()`** — return a plain, JSON-serializable object describing the
  current game state (see [Snapshot shape](#snapshot-shape)). It is a pure read:
  calling it never changes anything.

### Control operations

These set up a specific situation. Each one routes through the **same systems
normal play uses** — they arrange the world, they do not fake outcomes. Calling
any of them puts the paddles under the caller's control: both paddles then follow
the velocities set through `setPaddle` (defaulting to stationary) instead of the
keyboard or the AI, until the next `reset`.

- **`startMatch(mode)`** — start a real match, `mode` being `"solo"` or
  `"versus"`, exactly as choosing it from the menu would. The match opens on the
  pre-serve countdown.
- **`serve()`** — launch the ball now, ending the pre-serve countdown immediately
  instead of waiting it out. On a live rally it re-serves.
- **`setScore(p1, p2)`** — set the two scores directly (a precondition; the win
  and deuce rules still resolve through real play — drive a real point to end a
  match).
- **`setPaddle(side, state)`** — pose or move a paddle. `side` is `"left"` or
  `"right"`; `state` may set `cy` (center y) and/or `vy` (vertical velocity in
  px/s, which persists across steps so the paddle is moving when it strikes the
  ball — this is what drives the spin mechanic).
- **`setBall(index, state)`** — place and aim a ball. `index` selects the ball
  (`0` for the single ball; a mode with more than one ball numbers them in play
  order). `state` may set any of `x`, `y`, `vx`, `vy`, and `spin`.

A typical check: `startMatch("versus")`, `serve()`, `setPaddle` and `setBall` to
arrange the exact contact you want, `step()` a fraction of a second to run the
real collision, then read the result from `snapshot()`.

## Snapshot shape

`snapshot()` returns an object with at least these fields:

```js
{
  version: 1,
  screen: "title" | "howto" | "countdown" | "playing" | "paused" | "matchover",
  mode: "solo" | "versus",
  score: { p1: <number>, p2: <number> },
  winner: "left" | "right" | null,   // the winning side once the match is over
  paddles: {
    left:  { cy: <number>, vy: <number> },
    right: { cy: <number>, vy: <number> },
  },
  // Every ball currently in the game, in play order. A mode with one ball
  // reports a single-element array.
  balls: [
    { x: <number>, y: <number>, vx: <number>, vy: <number>,
      speed: <number>, spin: <number>, held: <boolean> },
  ],
  simTime: <number>,   // accumulated simulation time, in seconds
}
```

`held` is `true` while a ball is parked for its pre-serve countdown rather than in
flight. `speed` is the ball's current speed (the magnitude of its velocity).

## The debug overlay

Provide a **read-only** on-screen overlay that shows the game's live internal
state, so you can watch what the simulation is doing while you play. It is
**toggled with the backtick key** (`` ` ``), **off by default**, and it **never
changes gameplay** — it only draws.

When on, it draws (over the running game, legibly, in the game's monospace type)
at least: the current `screen` and `mode`, both scores, and for each ball its
position, velocity, speed, and spin, and for each paddle its center and velocity —
the same facts `snapshot()` reports. It is a diagnostic layer, not part of the
game's presentation, so keep it visually plain and clearly separate from the HUD.
