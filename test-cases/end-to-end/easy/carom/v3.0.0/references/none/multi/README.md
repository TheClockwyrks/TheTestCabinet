# Carom (Multi-ball) — `none` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`multi` variant on **no engine**. It is **never seeded into a run** — handing a
model the finished game would defeat the test — and takes no part in the case's
seed set. The case specs under `../../specs/`, rendered for the `multi` variant,
remain authoritative for the design.

The project is the case's seeded workspace (`../../workspaces/none/`) — ten
configuration files and nothing else, shared by every variant — with the whole of
`src/` written: the runtime the game stands on, the game, and the tests for both.
What is here is exactly what a `multi` run on no engine is asked to produce.

## What multi changes

**Three balls** are in play at once, and they share nothing. Each carries its own
velocity, its own spin, its own hold timer, and its own trail, and each launches
from its own home point on the centerline at a fresh **uniformly random angle**
over the whole circle — so there is no serve-direction rule to speak of. When one
ball crosses a goal edge it scores, returns to its own home, and relaunches on its
own hold while the other two carry on; the field is never frozen for a respawn.

The balls also collide **with each other**, as elastic circles of equal mass
(`resolveBallPairs` in `src/physics.ts`), and a ball waiting out its hold is an
immovable solid body rather than a ghost. The three advance in lock step through
the collision sub-steps, so a closing pair is resolved at the sub-step it meets.
In Solo the AI defends one ball at a time: of those flying at its goal, the one
arriving soonest (`threatBall` in `src/game.ts`).

---

**Carom** is a neon, top-down paddle duel for the browser. Two paddles face each
other across a dark field; three balls ricochet between them, off the top and
bottom walls, off a pair of fixed mid-field obstacles, and off each other. A
player scores when a ball passes the far edge behind their opponent's paddle.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes a ball curves that ball's flight afterward, so skilled play is about
shaping a ball's path, not just blocking it. The two fixed obstacles turn the open
field into a bank-shot puzzle, and three balls at once turn it into a triage
problem.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine and no runtime
dependency at all. No backend, accounts, network calls, or API keys; everything
needed to play is in the built bundle.

## Modes

- **Solo** — you (player one, left) versus a competent but beatable AI.
- **Versus** — two players share the keyboard.

Matches are first to **11 points**, win by **2** (deuce continues past 10-10).

## Controls

Every control is a **named action** bound to physical keys
(`KeyboardEvent.code`), so the bindings survive a non-QWERTY layout:

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

The **backtick** key (`` ` ``) toggles the diagnostics overlay. That key belongs
to the runtime (`src/overlay.ts`), not to the game.

**Spin:** swing your paddle (hold a movement key) as it strikes a ball to curve
the shot. Up and down swings curve it opposite ways; a stationary paddle imparts
no spin, and imparted spin fades within a couple of seconds. Where on the paddle
you make contact sets the angle: the center sends the ball straight across, the
top or bottom edge sends it off at up to ~55°.

## The runtime this project carries

Carom runs on no engine, so the layer every browser game needs is part of the
build. It is sized for this game rather than for every 2D game — there is no
asset loader, because Carom loads nothing — and it is five files:

- **`src/runtime.ts`** — the frame loop and the wiring. It measures each frame's
  delta in **seconds** (clamping the gap a backgrounded tab resumes with), clears
  the canvas, installs the logical transform, and calls `update` then `render`.
  There is no fixed timestep and no accumulator: every rate in
  `src/constants.ts` is per second and is integrated against the delta, so the
  same second of play reaches the same state however it was divided into frames.
  It also owns the **manual clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centered
  letterbox, and the device pixel ratio, re-derived at the top of every frame so
  no resize handler is needed. `src/render.ts` draws in logical `1280x720`
  coordinates and never reads the canvas element's size.
- **`src/keyboard.ts`** — named actions over `KeyboardEvent.code` bindings, with
  edge detection: an edge is armed when an action leaves rest, consumed by the
  first reader, and discarded at the end of its frame.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. Nothing about audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.

`src/main.ts` is the whole of the wiring between that layer and the game.

## Debugging and automation

The build exposes the surface `specs/instrumentation.md` specifies on
**`window.__carom`**, so a scenario can be posed in Carom's own world from code:

- `setAutoStep(enabled)` and `advance(seconds, frames)` — the **clock**. Nothing
  outside this build owns it, so the surface carries it: `setAutoStep(false)`
  stops the loop advancing the simulation from the wall clock, and
  `advance(seconds, frames)` runs that many whole frames — the same update the
  loop runs, then a render — covering that much game time. Drawing is unaffected
  either way, so the canvas always shows the state the last frame left. Because
  every rate is integrated against the frame's delta, `advance(1, 1)` and
  `advance(1, 60)` reach the same outcome.
- `reset(options?)` and `snapshot()` — return to the title screen (seedable) and
  read a JSON-serializable view of the full state.
- `startMatch(mode)`, `serve()`, `setScore(p1, p2)`, `setPaddle(side, state)`,
  and `setBall(index, state)` — set up a scenario through the game's own state;
  calling any of them hands paddle control to the caller until `reset()`.
  `setBall` addresses one of the three balls by its play-order index and takes it
  into live play, so a scenario can drive one ball with the other two parked;
  `serve()` ends the hold of every ball still waiting at its home point.
- `setAiControl(enabled)` — in Solo, hand the AI's paddle back to the computer
  opponent for the rest of a driven scenario, so a check can exercise the real AI
  against a posed shot.

Every operation but the two clock calls is a read or a pose of `CaromState`: they
arrange the world, and the game's own `update` is what runs from there on the
next frame. The two clock calls take nothing from the player — a scenario that
takes the game off real time to watch the **keyboard** move a paddle is exactly
what the control checks are — so there is deliberately no `keyDown`, `keyUp` or
`press` on the surface either, and no overlay toggle: the runtime owns the
backtick key and the panel.

The surface is inert during normal play.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

```sh
npm ci
```

This project depends on no runtime package at all: everything it runs on is in
`src/`, so `npm ci` installs the TypeScript toolchain and nothing else.

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

`npm test` runs the build's own suite **in process**, with no browser involved.
The runtime's own modules are checked directly; the game is checked by standing
the real runtime up over an `@napi-rs/canvas` canvas and a `Surface` of the
test's own, stepping it with `advance` — so a duration is an exact number of
frames of an exact length — and reading the result back from the game's state,
the cues its update played, and the pixels its render produced.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: stand the runtime up, initialize, install, run
  runtime.ts          The frame loop, the manual clock, and the wiring
  viewport.ts         The canvas fit: uniform scale, letterbox, pixel ratio
  keyboard.ts         Named actions over key codes, with edge detection
  audio-bus.ts        Web Audio cues and the first-gesture unlock
  overlay.ts          The diagnostics panel and the backtick key
  constants.ts        Palette, geometry, physics constants (logical 1280x720)
  debug.ts            The window.__carom surface over CaromState
  game.ts             The state contract, the state machine, and the three
                      functions the runtime drives
  rng.ts              The seeded generator, over CaromState.rngState
  entities.ts         Paddle and ball arithmetic, geometry, and the home points
  trail.ts            One ball's motion trail, a fixed slice of time
  physics.ts          Delta-time integration, collision (walls, paddles,
                      obstacles, and ball against ball), the spin mechanic
  ai.ts               The beatable AI opponent, defending one ball at a time
  render.ts           All canvas drawing (neon-on-charcoal), in logical space
  diagnostics.ts      The values the overlay shows
  audio.ts            The four audio cues
  *.test.ts           The build's own tests, beside the code they cover
```
