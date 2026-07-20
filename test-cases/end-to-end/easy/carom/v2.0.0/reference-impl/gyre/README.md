# Carom — Gyre

The **Gyre** variant of Carom. It is the base neon paddle duel with one twist:
the two mid-field obstacles are **live**. Each obstacle sways up and down and
spins in place, so instead of the axis-aligned bounces of the base game the ball
banks off **tilted, oriented faces**. Reading the obstacles' motion to shape a
bank shot is the heart of this variant.

Everything else matches the base game: the ball, the spin mechanic, paddle
angles and rally acceleration, the single ball served toward the receiver, the
AI, scoring (first to 11, win by 2), and both Solo and Versus modes.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or
API keys. It is the authored **reference implementation** of the Gyre variant:
the correct build, shown on the case's Reference tab. It is never seeded into a
run.

## The obstacle motion

Both obstacles are driven by a single **obstacle clock** `t` (seconds), so the
motion is fully reproducible on the fixed physics timestep:

- **Sway.** Each obstacle's center `y` oscillates about its base center with
  amplitude **80 px** and period **3.6 s**. The two sway in **anti-phase**, so
  the layout stays point-symmetric about the field center `(640, 360)` and
  neither side is favored.
- **Spin.** Each obstacle rotates about its own center at a constant **60°/s**.
  At `t = 0` both are upright, so a match opens in the familiar layout.

The clock advances every physics step of a live match — including during the
pre-serve countdown, so the obstacles are already moving when a ball is served —
is **frozen while paused**, and **resets to 0** at the start of each match.

Collision is resolved against each obstacle as an **oriented rectangle** (OBB)
at its current pose: the ball is transformed into the obstacle's local frame,
resolved against the axis-aligned box there, then the contact normal is rotated
back to world space and the velocity reflected about it (speed and spin
preserved). Obstacles are sampled per physics sub-step so a fast ball cannot
tunnel through a thin, tilted, moving obstacle. See `specs/obstacles.md` in the
test case.

## Controls

| Action | Keys |
| --- | --- |
| Move (Solo, player one) | `W` / `S` or `↑` / `↓` |
| Move player one (Versus) | `W` / `S` |
| Move player two (Versus) | `↑` / `↓` |
| Menu navigation | `↑` / `↓` (or `W` / `S`) |
| Confirm | `Enter` or `Space` |
| Back | `Esc` |
| Pause (in match) | `Esc` or `P` |
| Mute / unmute audio | `M` |

## Requirements

- Node.js 18+ and npm.

## Build

```sh
npm ci            # install exactly what the deploy installs
npm run build     # type-checks and emits the static site to dist/
npm run preview   # serve dist/ locally for a final check
```

`npm run dev` serves the game with hot-reload for development.

## Project layout

```
index.html            Vite entry; hosts the <canvas>
vite.config.ts        Build config (emits to dist/)
src/
  main.ts             Bootstrap: canvas fit/letterbox + fixed-timestep loop
  constants.ts        Palette, geometry, physics + obstacle constants
  types.ts            Shared types
  entities.ts         Ball and Paddle
  input.ts            Keyboard: held state + edge events
  audio.ts            Web Audio blips (mutable)
  trail.ts            Ball-position history for the motion trail
  obstacles.ts        Live-obstacle pose (sway + spin) and oriented collision
  physics.ts          Fixed-step integration, collision, the spin mechanic
  ai.ts               The beatable AI opponent
  game.ts             State machine, match flow, the obstacle clock
  render.ts           All canvas drawing (neon-on-charcoal)
```
