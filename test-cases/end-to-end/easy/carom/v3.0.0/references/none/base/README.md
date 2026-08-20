# Carom — `none` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`base` variant on **no engine**: the runtime this project needs is part of it, in
`src/host.ts`. It is **never seeded into a run** — handing a model the finished
game would defeat the test — and takes no part in the case's seed set. The case
specs under `../../specs/` remain authoritative for the design.

The project is the case's seeded workspace (`../../workspaces/base/none/`) with
`src/game.ts` implemented and its own tests written beside it, so what is here is
exactly what a run on this engine is asked to produce.

---

**Carom** is a neon, top-down paddle duel for the browser. Two paddles face each
other across a dark field; a ball ricochets between them, off the top and bottom
walls, and off a pair of fixed mid-field obstacles. A player scores when the ball
passes the far edge behind their opponent's paddle.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes the ball curves the ball's flight afterward, so skilled play is about
shaping the ball's path, not just blocking it. The two fixed obstacles turn the
open field into a bank-shot puzzle.

This is a self-contained static web app — plain **TypeScript** over its own
runtime, drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

## Modes

- **Solo** — you (player one, left) versus a competent but beatable AI.
- **Versus** — two players share the keyboard.

Matches are first to **11 points**, win by **2** (deuce continues past 10-10).

## Controls

Every control is a **registered action** on the `dual-vertical` touch layout,
bound to these keys:

| Action              | Keys               | Does                                                                    |
| ------------------- | ------------------ | ----------------------------------------------------------------------- |
| `p1-up` / `p1-down` | `W` / `S`          | Moves player one's (left) paddle.                                       |
| `p2-up` / `p2-down` | `↑` / `↓`          | Moves player two's (right) paddle — and, in Solo, player one's as well. |
| `confirm`           | `Enter` or `Space` | Accepts the selected menu item.                                         |
| `back`              | `Esc`              | Goes back a screen.                                                     |
| `pause`             | `P` or `Esc`       | Pauses during a match.                                                  |
| `mute`              | `M`                | Toggles mute, on any screen.                                            |

Either side's up/down action moves a menu selection, so the menus answer to
`W`/`S` and `↑`/`↓` alike. `Esc` drives **two** actions — `pause` and `back` —
and the game reads whichever the current screen calls for, so it pauses in a
match and steps back on a menu.

The **backtick** key (`` ` ``) toggles the runtime's debug overlay. That key
belongs to `src/host.ts`, not to this game.

**Spin:** swing your paddle (hold a movement key) as it strikes the ball to curve
the shot. Up and down swings curve it opposite ways; a stationary paddle imparts
no spin, and imparted spin fades within a couple of seconds. Where on the paddle
you make contact sets the angle: the center sends the ball straight across, the
top or bottom edge sends it off at up to ~55°.

## What the runtime owns

This build runs on no engine, so the runtime every browser game needs is part of
the project, in `src/host.ts`. It supplies everything that is the same in every
browser game, and none of it is the game's:

- **The frame loop and its delta time.** `update(state, api, dt)` receives the
  real elapsed **seconds** of the frame, and every rate in `src/constants.ts` is
  per second and is integrated against it. There is no fixed timestep and no
  accumulator — the same second of play reaches the same state however it was
  divided into frames.
- **The canvas fit.** The uniform scale, the centered letterbox, the device pixel
  ratio, and the resync when any of them changes. `src/render.ts` draws in logical
  `1280x720` coordinates and never reads the canvas element's size.
- **Input.** Named actions over `KeyboardEvent.code` bindings, with edge detection
  done once and correctly.
- **Audio.** The Web Audio graph, cue synthesis, mute, and the first-gesture
  unlock. The game declares four cues and plays them by name.
- **The debug overlay.** The panel, the toggle key, and its read-only-ness; the
  game only names the values it shows.

What is left is the game: the simulation, the drawing, and the state the debug
API poses.

## Debugging and automation

The game exposes a small debugging and automation API on **`window.__carom`** so a
scenario can be posed in Carom's own world from code:

- `reset(options?)` and `snapshot()` — return to the title screen (seedable) and
  read a JSON-serializable view of the full state.
- `startMatch(mode)`, `serve()`, `setScore(p1, p2)`, `setPaddle(side, state)`, and
  `setBall(index, state)` — set up a scenario through the game's own state;
  calling any of them hands paddle control to the caller until `reset()`.
- `setAiControl(enabled)` — in Solo, hand the AI's paddle back to the computer
  opponent for the rest of a driven scenario, so a check can exercise the real AI
  against a posed shot.

Every one of those is a read or a pose of `CaromState`: they arrange the world,
and the game's own `update` is what runs from there when the runtime advances a
frame.

Everything about _driving a browser game_ rather than about Carom is the
runtime's. The clock, the exact frames, and the registered actions are driven by
standing a host up directly, which is what `src/host.test.ts` does. So there is
deliberately no `step`, `setAutoStep`, `keyDown`, `keyUp`, or `press` on
`window.__carom`.

The surface is inert during normal play.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

```sh
npm ci
```

This project depends on no runtime package: `src/host.ts` is the runtime and it
is built and bundled with the rest of the sources, so `npm ci` installs the
TypeScript toolchain and nothing else.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
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

## Checks

```sh
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier --check
npm test               # vitest, with coverage over src/
```

`npm test` runs the build's own suite **in process**: it builds a real host over
an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it with
`host.advance` against a `ConstantClock`, and reads the result back from the
game's state, the host's events, and the pixels the render produced. No browser is
involved.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: stand the host up, initialize, install, run
  host.ts             The runtime: frame loop, canvas fit, input, audio, overlay
  constants.ts        Palette, geometry, physics constants (logical 1280x720)
  debug.ts            The window.__carom surface over CaromState
  game.ts             The state contract, the state machine, and the three
                      functions the host drives
  rng.ts              The seeded generator, over CaromState.rngState
  entities.ts         Paddle and ball arithmetic and geometry
  trail.ts            The ball's motion trail, a fixed slice of time
  physics.ts          Delta-time integration, collision, the spin mechanic
  ai.ts               The beatable AI opponent
  render.ts           All canvas drawing (neon-on-charcoal), in logical space
  diagnostics.ts      The values the runtime's overlay shows
  audio.ts            The four audio cues
  *.test.ts           The build's own tests, beside the code they cover
```
