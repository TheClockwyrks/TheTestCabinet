# Carom (Multi-ball) — `simple-2d` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`multi` variant, on the
[Simple 2D](../../../../../../../../packages/simple-2d) engine. Carom supports two
engines and ships one reference build per engine per variant, so this is the
answer a `multi` run on `simple-2d` is shown. It is **never seeded into a run** —
handing a model the finished game would defeat the test — and takes no part in the
case's seed set. The case specs under `../../specs/`, rendered for the `multi`
variant, remain authoritative for the design.

The project is the variant's seeded workspace
(`../../workspaces/multi/simple-2d/`) with `src/game.ts` implemented and its own
tests written beside it, so what is here is exactly what a run of this variant on
this engine is asked to produce.

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

**Carom** is a top-down paddle duel for the browser. Two paddles face each
other across a dark field; three balls ricochet between them, off the top and
bottom walls, off a pair of fixed mid-field obstacles, and off each other. A
player scores when a ball passes the far edge behind their opponent's paddle.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes a ball curves that ball's flight afterward, so skilled play is about
shaping a ball's path, not just blocking it. The two fixed obstacles turn the open
field into a bank-shot puzzle, and three balls at once turn it into a triage
problem.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

The look is this build's own: the specification fixes what must be visible (a
dark field, bright solid bodies that stand apart from it and from each other, the
scores near the top, a label naming the mode) and leaves the rest to the build.
This one is neon on charcoal, with its palette, type, HUD layout, and tagline in
`src/theme.ts`; every figure the specification does fix is in `src/constants.ts`.

## Modes

- **Solo** — you (player one, left) versus a competent but beatable AI.
- **Versus** — two players share the keyboard.

Matches are first to **11 points**, win by **2** (deuce continues past 10-10).

## Controls

Every control is a **registered engine action** on the `dual-vertical` touch
layout, bound to these keys:

| Action              | Keys               | Does                                                                                                     |
| ------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `p1-up` / `p1-down` | `W` / `S`          | Moves player one's (left) paddle.                                                                        |
| `p2-up` / `p2-down` | `↑` / `↓`          | Moves player two's (right) paddle — and, in Solo, player one's as well.                                  |
| `confirm`           | `Enter` or `Space` | Accepts the selected menu item.                                                                          |
| `back`              | `Esc`              | Goes back a screen: resumes from the pause menu, leaves the how-to and match-over screens for the title. |
| `pause`             | `P` or `Esc`       | Pauses during a match.                                                                                   |
| `mute`              | `M`                | Toggles mute, on any screen.                                                                             |

Either side's up/down action moves a menu selection, so the menus answer to
`W`/`S` and `↑`/`↓` alike. `Esc` drives **two** actions — `pause` and `back` — and
raises both on the same frame; `pause` is read on the countdown, on the live game,
**and on the pause menu**, so one `Esc` opens the pause menu and leaves it open,
and one `Esc` on the pause menu resumes exactly once. `P` does the same on both
sides of the pause.

The menus also answer to a **mouse and to touch**. Each item occupies a hit region
the build lays out (`src/menu.ts`), which `menuItemRect` on the debug surface
reports in logical units, so what a pointer selects is exactly what is drawn.
Moving onto an item highlights it, a finger's landing does the same (a finger
cannot hover), and an item is confirmed when a press and the release that follows
it both fall inside that one item — a press begun on one item and released on
another confirms nothing.

The **backtick** key (`` ` ``) toggles the engine's debug overlay. That key
belongs to the engine, not to this game.

**Spin:** swing your paddle (hold a movement key) as it strikes a ball to curve
the shot. Up and down swings curve it opposite ways; a stationary paddle imparts
no spin, and imparted spin fades within a couple of seconds. Where on the paddle
you make contact sets the angle: the center sends the ball straight across, the
top or bottom edge sends it off at up to ~55°.

## What the engine owns

`@clockwyrks/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here:

- **The frame loop and its delta time.** `update(state, api, dt)` receives the
  real elapsed **seconds** of the frame, and every rate in `src/constants.ts` is
  per second and is integrated against it. There is no fixed timestep and no
  accumulator — the same second of play reaches the same state however it was
  divided into frames.
- **The state, held by value.** The engine hands `update` the current state as a
  read-only view (`DeepReadonly<CaromState>`) and stores whatever it returns as
  the next state; `render` is handed that next state under the same view, and
  `engine.state` reads it. Nothing in this build holds a writable `CaromState`.
- **The canvas fit.** The uniform scale, the centered letterbox, the device pixel
  ratio, and the resync when any of them changes. `src/render.ts` draws in logical
  `1280x720` coordinates and never reads the canvas element's size.
- **Input.** Named actions over `KeyboardEvent.code` bindings, with edge detection
  done once and correctly, and the pointer — mouse, pen, or finger — mapped
  through the same letterboxed fit the game draws under, so a position `update`
  reads and a region `menuItemRect` reports lie in one coordinate space.
- **Audio.** The Web Audio graph, cue synthesis, mute, and the first-gesture
  unlock. The game declares five cues and plays them by name.
- **The debug overlay.** The panel, the toggle key, and its read-only-ness; the
  game only names the values it shows.

What is left is the game: the simulation, the drawing, and the state the debug
API poses.

## Debugging and automation

The game exposes a small debugging and automation API **through the engine**, so a
scenario can be posed in Carom's own world from code. `src/debug.ts` builds the
surface, `initialize` returns it beside the state as
`[createInitialState(), createDebugApi()]`, and a caller reads that same object
back off **`engine.debug`** — the engine returns it unchanged and reads no member
of it. Nothing is published on the page, so a check reaches the surface through
the engine it constructed rather than through the document the build is drawn on.

Because the state is a value and nothing holds a writable one, the surface is
written in the shape of `update`: every operation is a function of the state it
is handed. A **pose** takes the current state and returns the next, and a caller
drives it through `engine.apply`, which stores what it returns as the state the
next frame receives; a **reading** takes the state and returns what it read, and a
caller hands it `engine.state`.

```ts
engine.apply((s) => engine.debug.setScreen(s, "countdown"));
engine.apply((s) => engine.debug.setBallPosition(s, 0, 300, 360));
engine.apply((s) => engine.debug.setBallVelocity(s, 0, 400, 0));
await engine.advance(6);
const { balls } = engine.debug.snapshot(engine.state);
```

**Every operation is atomic.** Each one sets one field, or one fixed pair of
fields, or places or removes one entity — there is no patch object and nothing
that arranges several unrelated things at once, so a scenario is built by saying
what it wants one fact at a time and nothing it did not ask for moves. `reset` is
the sole exception, and it is a lifecycle verb rather than a pose: it restores
every declared field at once, leaving only the mute bit alone.

- **The world.** `clearWorld(state)` empties the field of every ball and every
  obstacle; `spawnBall(state, index)` and `spawnObstacle(state, index)` put one
  back, in play order. An absent ball takes no part in a frame — it is not
  advanced, not drawn, collides with nothing, and scores nothing. `reset(state)`
  and `setSeed(state, seed)` complete the group.
- **Screens and menus.** `setScreen`, `setMode`, `setMenuIndex`, `setTitleIndex`,
  and `setResumeScreen`, each setting its own field alone.
- **Match state.** `setScore(state, p1, p2)` and `setWinner(state, side)`. The win
  and deuce rules still resolve through real play.
- **Paddles.** `setPaddleCy(state, side, cy)`, `setPaddleVy(state, side, vy)`, and
  `setPaddleDriven(state, side, driven)`. Each side is taken **on its own**, so a
  scenario can drive one paddle and leave the other to a real player or to the
  real AI. `drivenVy` is the velocity a driven paddle travels at and holds across
  frames; `vy` is what the last frame actually integrated, which is what the spin
  mechanic reads at contact.
- **Balls.** `setBallPosition`, `setBallVelocity`, `setBallSpin`, `setBallHeld`,
  and `setBallHoldTimer`, each taking the ball's play-order **`index` first**.
  An operation naming an absent ball does nothing at all.
- **The AI.** `setAiTracking(state, enabled)` and `setAiMovement(state, enabled)`
  gate the opponent's two faculties separately: sensing the balls, and travelling
  toward the target.
- **Audio.** `setMuted(state, muted)` sets the mute bit the `mute` action
  toggles. The state carries it and `update` brings the engine's bus into line.
- **Readings.** `snapshot(state)` returns the whole declared state as plain JSON —
  every field an operation sets appears there — and `menuItemRect(state, index)`
  returns the hit region of an item on the menu the current screen shows, or
  `null` on the countdown and the live game, which show none.
- `version` — a plain number.

Every one of those is a read or a pose of `CaromState`: they arrange the world,
and the game's own `update` is what runs from there when the engine advances a
frame. None of them writes to the state it is handed.

Everything about _driving a browser game_ rather than about Carom is the
engine's. The clock, the exact frames, the registered actions, and the pointer are
driven by constructing an engine directly (which is what `src/engine.test.ts`
does), so the surface deliberately carries no `advance`, `setAutoStep`, `keyDown`,
`keyUp`, or `press`. A check that wants the frames a scenario drew arms the
engine's draw-command recorder around that section and keeps the recording.

The surface is inert during normal play.

## How the code is shaped

Every module under `src/` is pure: a function takes a state, or a slice of one
(a ball, a paddle, the generator's word), and returns a new value, built by
spreading the parts that change over the parts that do not. There is no
module-level game state and no closure over mutable data. So `step` in
`src/physics.ts` returns `{ balls, events }` rather than writing the balls it was
given, `updateAi` returns the paddle after the frame, `recordTrail` returns the
ball with a longer trail, and a draw from `src/rng.ts` returns
`[value, nextRngState]` for the caller to thread into the state it builds. The
state type declares every field `readonly` and every array as a readonly array,
so the `DeepReadonly<CaromState>` view the engine hands out and `CaromState` are
the same shape, and a spread of one is the other with no cast.

The one value that is neither authoritative game state nor derivable from it is
the pointer presses the menus are waiting on a release for: specs/ui.md confirms
an item only when a press and its release both fall inside it, and the two edges
may arrive on different frames. It lives in `CaromState` all the same, because
every value the game carries from one frame to the next belongs there rather than
in a module-level variable or a closure. Nothing in the snapshot reports it and no
operation of the debug surface poses it.

The diagnostic sources (`src/diagnostics.ts`) are registered once, in
`initialize`, as functions of the state the engine hands them at each read — the
state this frame's `update` returned — rather than as closures over the state
`initialize` built, which would be the title screen forever.

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

The engine, `@clockwyrks/simple-2d`, is a relative `file:` dependency on the
repository's `packages/simple-2d`, which npm installs as a symlink, so this
project builds and tests against the engine's current source. A run receives the
same package at `.vendor/engine/@clockwyrks/simple-2d/` instead, so the import
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
`engine.advance` against a `ConstantClock`, and reads the result back from the
game's state, the engine's events, and the pixels the render produced. No browser
is involved.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720),
                      seeded by the case
  theme.ts            This build's own look: palette, type, HUD layout, tagline
  flow.ts             The poses a match moves between: the title, the opening
                      of a match, and the complete initial state
  menu.ts             The menus' layout: where each item is drawn, and the hit
                      region a pointer or a finger selects it from
  pointer.ts          The menus under a mouse and a finger: selection on a move
                      or a landing, confirmation on a press and its release
  debug.ts            The debug surface: poses and readings over CaromState,
                      returned beside the state by game.ts's initialize
  game.ts             The state contract, the state machine, and the three
                      functions the engine drives
  rng.ts              The seeded generator: a draw from CaromState.rngState
                      returns the value beside the next state
  entities.ts         Paddle, ball, and obstacle arithmetic, geometry, and the
                      home points
  trail.ts            One ball's motion trail, a fixed slice of time
  physics.ts          Delta-time integration, collision (walls, paddles,
                      obstacles, and ball against ball), the spin mechanic
  ai.ts               The beatable AI opponent, defending one ball at a time
  render.ts           All canvas drawing, in logical space
  diagnostics.ts      The values the engine's overlay shows
  audio.ts            The five engine cues
  *.test.ts           The build's own tests, beside the code they cover
```
