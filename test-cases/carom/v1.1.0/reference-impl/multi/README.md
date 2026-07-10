# Carom — Multi-ball

The **Multi-ball** variant of Carom. It is the base neon paddle duel, but with
**three balls in play at once** — each its own independent contest. Every ball
carries its own velocity and its own spin, has its own fixed home point, and
runs its own countdown: when a ball leaves the field it resets and relaunches on
its own while the other two carry on uninterrupted. The field never freezes.

Everything else matches the base game: the ball physics and the spin mechanic,
paddle angles and rally acceleration, the two fixed mid-field obstacles, scoring
(first to 11, win by 2, points from all three balls sharing the two scores), and
both Solo and Versus modes.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or
API keys. It is the authored **reference implementation** of the Multi-ball
variant: the correct build, shown on the case's Reference tab. It is never seeded
into a run.

## What makes Multi-ball different

- **Three distinct home points** on the centerline (`x = 640`) at 25% / 50% /
  75% of the field height: `(640, 180)`, `(640, 360)`, `(640, 540)`. A ball
  always returns to its own home point.
- **Random 360° launches.** Every launch — the first serve and every relaunch —
  sends the ball out at a uniformly random angle over the full circle,
  independent of where it was or which side scored. (So, unlike the base and
  gyre variants, there is no serve-direction rule.)
- **Independent per-ball respawn.** When a ball crosses a goal edge it scores,
  returns to its own home point, and begins a fresh 1.0 s countdown before
  relaunching — while the other two balls play on, never reset.
- **Ball-to-ball collision.** The balls collide as equal-mass elastic circles:
  two moving balls swap their velocity components along the line of centers; a
  ball held at its home point during its countdown is solid and immovable, so a
  moving ball simply bounces off it. Collisions change neither spin nor speed.
- **The AI faces three balls.** In Solo it defends the ball that most
  immediately threatens its goal (the incoming ball that will reach it soonest)
  rather than trying to cover all three, and stays clearly beatable.

See `specs/balls.md` in the test case for the authoritative rules.

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
  constants.ts        Palette, geometry, physics constants, the three homes
  types.ts            Shared types
  entities.ts         Ball (home point + own countdown) and Paddle
  input.ts            Keyboard: held state + edge events
  audio.ts            Web Audio blips (optional, mutable)
  trail.ts            Ball-position history for the motion trail (one per ball)
  physics.ts          Fixed-step integration, collision, spin, ball-to-ball
  ai.ts               The beatable AI opponent
  game.ts             State machine, three-ball flow, per-ball respawns
  render.ts           All canvas drawing (neon-on-charcoal)
```
