# Carom

**Carom** is a neon, top-down paddle duel for the browser. Two paddles face each
other across a dark field; a ball ricochets between them, off the top and bottom
walls, and off a pair of fixed mid-field obstacles. A player scores when the
ball passes the far edge behind their opponent's paddle.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes the ball curves the ball's flight afterward, so skilled play is about
shaping the ball's path, not just blocking it. The two fixed obstacles turn the
open field into a bank-shot puzzle.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or
API keys; everything needed to play is in the built bundle.

## Modes

- **Solo** — you (player one, left) versus a competent but beatable AI.
- **Versus** — two players share the keyboard.

Matches are first to **11 points**, win by **2** (deuce continues past 10-10).

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
| Toggle debug overlay | `` ` `` (backtick) |

**Spin:** swing your paddle (hold a movement key) as it strikes the ball to
curve the shot. Up and down swings curve it opposite ways; a stationary paddle
imparts no spin, and imparted spin fades within a couple of seconds. Where on the
paddle you make contact sets the angle: the center sends the ball straight
across, the top or bottom edge sends it off at up to ~55°.

## Debugging and automation

The game exposes a small debugging and automation API on **`window.__carom`** so
it can be driven and inspected from code without the keyboard or real-time
waiting — handy for iterating on the physics, reproducing a rally, or writing
automated checks:

- `reset(options?)`, `step(seconds)`, and `snapshot()` — reset to the title
  screen (seedable), advance the real simulation in whole fixed steps, and read a
  JSON-serializable view of the full state.
- `startMatch(mode)`, `serve()`, `setScore(p1, p2)`, `setPaddle(side, state)`,
  and `setBall(index, state)` — set up a scenario through the game's real
  systems; calling any of them hands paddle control to the caller until `reset()`.
- `setAiControl(enabled)` — in Solo, hand the AI's paddle back to the computer
  opponent for the rest of a driven scenario, so a check can exercise the real AI
  against a posed shot; the left paddle and ball stay under the caller's control.
- `keyDown(code)`, `keyUp(code)`, and `press(code)` — inject keyboard input
  through the same path the real keyboard feeds, so a caller can navigate the
  menus, start a match, pause, toggle mute, and move a paddle exactly as a player
  would. Unlike the control ops above, this does **not** take paddle control away
  from normal play, so it exercises the actual key bindings. `snapshot()` also
  reports `muted`, so a caller can confirm the mute key took effect.

The **backtick** key toggles a read-only on-screen overlay of the same live state
(`src/debug.ts`, `src/render.ts`). Both are inert during normal play.

## Requirements

- Node.js 18+ and npm. No other toolchain is needed.

## Install

```sh
npm ci        # or: npm install
```

## Run in development

```sh
npm run dev
```

Vite serves the game with hot-reload at the URL it prints (default
`http://localhost:5173`).

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root. Serve that directory as-is from any static file
server:

```sh
npm run preview        # serves dist/ locally for a final check
```

## Project layout

```
index.html            Vite entry; hosts the <canvas>
vite.config.ts        Build config (emits to dist/)
src/
  main.ts             Bootstrap: canvas fit/letterbox + fixed-timestep loop
  constants.ts        Palette, geometry, physics constants (logical 1280x720)
  types.ts            Shared types
  entities.ts         Ball and Paddle
  input.ts            Keyboard: held state + edge events
  audio.ts            Web Audio blips (mutable)
  trail.ts            Ball-position history for the motion trail
  physics.ts          Fixed-step integration, collision, the spin mechanic
  ai.ts               The beatable AI opponent
  game.ts             State machine, match flow, per-step update
  render.ts           All canvas drawing (neon-on-charcoal) + debug overlay
  debug.ts            window.__carom debugging / automation API
```
