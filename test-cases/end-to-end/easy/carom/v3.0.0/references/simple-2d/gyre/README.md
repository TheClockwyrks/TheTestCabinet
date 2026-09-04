# Carom (Gyre) — `simple-2d` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`gyre` variant, on the
[Simple 2D](../../../../../../../../packages/simple-2d) engine. Carom supports two
engines and ships one reference build per engine per variant, so this is the
answer a `gyre` run on `simple-2d` is shown. It is **never seeded into a run** —
handing a model the finished game would defeat the test — and takes no part in
the case's seed set. The case specs under `../../specs/`, rendered for the `gyre`
variant, remain authoritative for the design.

The project is the variant's seeded workspace
(`../../workspaces/gyre/simple-2d/`) with `src/game.ts` implemented and its own
tests written beside it, so what is here is exactly what a run of this variant on
this engine is asked to produce.

## What gyre changes

The two mid-field obstacles are **live**: each sways vertically about its base
center and rotates continuously about its own center, both as pure functions of
an **obstacle clock** (`src/obstacles.ts`). The ball therefore bounces off an
**oriented** rectangle rather than an axis-aligned box — the collision in
`src/physics.ts` works in each obstacle's own frame and carries only the contact
normal back out to the world. The clock advances with the frame through a live
match, is frozen while paused, and resets at the start of each match. Freezing it
deliberately is its **own** gate — `setObstacleClockRunning(false)` on the debug
surface — so a check can face one chosen, known orientation without taking
anything else away.

---

**Carom** is a top-down paddle duel for the browser. Two paddles face each
other across a dark field; a ball ricochets between them, off the top and bottom
walls, and off a pair of swaying, spinning mid-field obstacles. A player scores when the ball
passes the far edge behind their opponent's paddle.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes the ball curves the ball's flight afterward, so skilled play is about
shaping the ball's path, not just blocking it. The two moving, rotating obstacles turn the
open field into a bank-shot puzzle whose angles change as you line the shot up.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

The look — a neon-on-charcoal palette, a system monospace stack, where the HUD
sits, and the tagline — is this build's own choice, held in `src/theme.ts`. The
specification fixes only what must be visible; every figure it does fix comes
from `src/constants.ts`, which is the case's seeded file, unedited.

## Modes

- **Solo** — you (player one, left) versus a competent but beatable AI.
- **Versus** — two players share the keyboard.

Matches are first to **11 points**, win by **2** (deuce continues past 10-10).

## Controls

Every control is a **registered engine action** on the `dual-vertical` touch
layout, bound to these keys:

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
and the game reads whichever the current screen calls for: a single `Esc` opens
the pause menu during a match and closes it again from the pause menu, and it
returns to the title from the how-to and match-over screens. `P` does the same
opening and closing.

**The menus also take a mouse and a finger.** Moving the pointer onto an item
highlights it, and a press and release inside that one item chooses it; a finger
highlights the item it lands on and chooses it by lifting there. Sliding off the
item you pressed and releasing somewhere else chooses nothing, which is the usual
way to change your mind mid-press. Each item's hit region is `src/menus.ts`'s
one table, which is also what `src/render.ts` draws from and what the debug
surface's `menuItemRect` reports — so the item highlighted is always the item
chosen.

Returning to the title always highlights the entry that led away from it.

The **backtick** key (`` ` ``) toggles the engine's debug overlay. That key
belongs to the engine, not to this game.

**Spin:** swing your paddle (hold a movement key) as it strikes the ball to curve
the shot. Up and down swings curve it opposite ways; a stationary paddle imparts
no spin, and imparted spin fades within a couple of seconds. Where on the paddle
you make contact sets the angle: the center sends the ball straight across, the
top or bottom edge sends it off at up to ~55°.

## What the engine owns

`@test-cabinet/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here:

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

## The state is a value

`src/game.ts` declares `CaromState` with every field `readonly` and every array
a `readonly` array, and the engine holds it **by value**. Each frame the engine
calls `update(state, api, dt)` with the current state as a `DeepReadonly` view
(imported from `ts-essentials`) and stores the **new state it returns**; `render`
is handed that new state and draws it; `engine.state` reads it back. Nothing in
this build holds a writable state and nothing advances the simulation except a
transition that returns the next one, and the compiler is what says so.

Every simulation function is therefore written in the same shape — current
value in, next value out, built with spreads and `map` — whether it is the whole
state (`serve`, `startMatch`, `toTitle`, `resolvePointer`) or a slice of it
(`step(ball, left, right, obstacles, dt)` returns `{ ball, events }`;
`integratePaddle` and `updateAi` return the next paddle; `recordTrail` returns the
next ball; `nextSign(rngState)` returns `[sign, nextRngState]`). The diagnostic sources the
overlay shows are registered as `(state) => value` and read whatever state the
engine hands them
at the moment of the read, so the overlay can never report a frame the game has
moved on from.

## Debugging and automation

The game exposes a small debugging and automation API **through the engine**, so a
scenario can be posed in Carom's own world from code. `src/debug.ts` implements
the surface, `initialize` returns it beside the opening state as
`[createInitialState(), createDebugApi()]`, and a caller reads that same object
back off **`engine.debug`** — the engine returns it unchanged and reads no
member of it. Nothing is published on the page, so a check reaches the surface
through the engine it constructed rather than through the document the build is
drawn on.

Because no one may hold a writable state, every operation is written in the
shape of `update`. A **pose** takes the current state and returns the next, and
a caller drives it through `engine.apply`, which replaces the engine's state with
what the pose returned so the next frame's `update` receives it:

```ts
engine.apply((s) => engine.debug.setScreen(s, "countdown"));
engine.apply((s) => engine.debug.setBallPosition(s, 300, 360));
```

A **reading** takes the state and returns what it read:

```ts
const { ball } = engine.debug.snapshot(engine.state);
const rect = engine.debug.menuItemRect(engine.state, 1);
```

**Every operation is atomic**: each one sets one field, or one fixed pair of
fields, or places or removes one entity, or reads the state. None of them takes a
partial object and merges it, and none arranges several unrelated things at once,
so a check assembles exactly the arrangement its requirement needs and nothing
else happens. `reset` is the one exception, and it is a lifecycle verb rather
than a pose: it restores every declared field at once.

- **The world** — `clearWorld(state)`, `spawnBall(state)`,
  `spawnObstacle(state, index)`, `reset(state)`, `setSeed(state, seed)`.
- **Screens and menus** — `setScreen`, `setMode`, `setMenuIndex`,
  `setTitleIndex`, `setResumeScreen`.
- **The match** — `setScore(state, p1, p2)`, `setWinner`, `setReceiver`.
- **The paddles** — `setPaddleCy(state, side, cy)`,
  `setPaddleVy(state, side, vy)` (the velocity a **driven** paddle travels at),
  and `setPaddleDriven(state, side, driven)`, which takes **one** side and leaves
  the other under its player or the AI.
- **The ball** — `setBallPosition`, `setBallVelocity`, `setBallSpin`,
  `setBallHeld`, `setBallHoldTimer`. Gyre plays with one ball, so none of them
  takes an index.
- **The AI** — `setAiTracking` and `setAiMovement`, one per faculty: sensing the
  ball and travelling toward the target are gated separately.
- **The obstacle clock** — this variant's own: `setObstacleClock(state, t)` poses
  it, and `setObstacleClockRunning(state, running)` decides whether it advances
  with the frame.
- **Readings** — `snapshot(state)`, a JSON-serializable view of the whole
  declared state, and `menuItemRect(state, index)`, the hit region of an item on
  the menu the current screen shows.

`version` is a plain number. Every operation arranges the world and fabricates
no outcome: the game's own `update` is what runs from there when the engine
advances a frame.

Everything about _driving a browser game_ rather than about Carom is the
engine's. The clock, the exact frames, and the registered actions are driven by
constructing an engine directly (which is what `src/engine.test.ts` does), so the
surface deliberately carries no `advance`, `setAutoStep`, `keyDown`, `keyUp`, or
`press`. A check that wants the frames a scenario drew arms the engine's
draw-command recorder around that section and keeps the recording.

Both surfaces are inert during normal play.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

From the repository root, install the npm workspace and build its packages:

```sh
npm ci && npm run build:packages
```

Then, in this directory:

```sh
npm ci
```

The engine, `@test-cabinet/simple-2d`, is a relative `file:` dependency on the
repository's `packages/simple-2d`, which npm installs as a symlink, so this
project builds and tests against the engine's current source. A run receives the
same package at `.tcab/engine/@test-cabinet/simple-2d/` instead, so the import
in the sources is the same either way.

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

`npm test` runs the build's own suite **in process**: it builds a real engine over
an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it with
`engine.advance` against a `ConstantClock`, poses it with `engine.apply`, and
reads the result back from `engine.state`, the engine's events, and the pixels
the render produced. No browser is involved. The unit tests beside each module
call its transitions directly and assert on the values they return.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (case-provided)
  theme.ts            This build's own look: palette, type, HUD layout, copy
  debug.ts            The debug surface: poses and readings over CaromState,
                      returned beside the opening state by game.ts's initialize
  game.ts             The (readonly) state contract, the state machine as
                      transitions, and the three functions the engine drives
  screens.ts          The title, match-opening, pause and confirm transitions
                      the menus and the debug surface share
  menus.ts            One table per menu: the items, where each row is drawn,
                      and the region a pointer selects it from
  pointer.ts          The mouse and touch rule over that table, pure over one
                      frame's pointer samples
  rng.ts              The seeded generator: a draw returns [value, nextState]
  entities.ts         Paddle and ball arithmetic and geometry
  trail.ts            The ball's motion trail, a fixed slice of time
  obstacles.ts        The obstacle poses, pure functions of the obstacle clock
  physics.ts          Delta-time integration, collision, the spin mechanic;
                      step() returns the next ball and its events
  ai.ts               The beatable AI opponent
  render.ts           All canvas drawing, in logical space
  diagnostics.ts      The values the engine's overlay shows, each (state) => value
  audio.ts            The four engine cues
  *.test.ts           The build's own tests, beside the code they cover
```
