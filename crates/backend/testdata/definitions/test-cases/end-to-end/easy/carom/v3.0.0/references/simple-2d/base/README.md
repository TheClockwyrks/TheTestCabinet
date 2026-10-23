# Carom — `simple-2d` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`base` variant, on the
[Simple 2D](../../../../../../../../packages/simple-2d) engine. Carom supports two
engines and ships one reference build per engine, so this is the answer a run on
`simple-2d` is shown. It is **never seeded into a run** — handing a model the
finished game would defeat the test — and takes no part in the case's seed set.
The case specs under `../../specs/` remain authoritative for the design.

The project is the case's seeded workspace (`../../workspaces/base/simple-2d/`)
with `src/game.ts` implemented and its own tests written beside it, so what is
here is exactly what a run on this engine is asked to produce.

---

**Carom** is a top-down paddle duel for the browser. Two paddles face each other
across a dark field; a ball ricochets between them, off the top and bottom
walls, and off a pair of fixed mid-field obstacles. A player scores when the ball
passes the far edge behind their opponent's paddle. The neon-on-charcoal look is
this build's own choice: the specification fixes the rules and leaves the
palette, type, and layout to the build, so they live in `src/theme.ts` rather
than beside the case-fixed figures in `src/constants.ts`.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes the ball curves the ball's flight afterward, so skilled play is about
shaping the ball's path, not just blocking it. The two fixed obstacles turn the
open field into a bank-shot puzzle.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

## Modes

- **Solo** — you (player one, left) versus a competent but beatable AI.
- **Versus** — two players share the keyboard.

Matches are first to **11 points**, win by **2** (deuce continues past 10-10).

## Controls

Every control is a **registered engine action** on the `dual-vertical` touch
layout, bound to these keys:

| Action              | Keys               | Does                                                                                                                      |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `p1-up` / `p1-down` | `W` / `S`          | Moves player one's (left) paddle.                                                                                         |
| `p2-up` / `p2-down` | `↑` / `↓`          | Moves player two's (right) paddle — and, in Solo, player one's as well.                                                   |
| `confirm`           | `Enter` or `Space` | Accepts the selected menu item.                                                                                           |
| `back`              | `Esc`              | Goes back a screen: leaves how-to-play, resumes from the pause menu, and returns to the title from the match-over screen. |
| `pause`             | `P` or `Esc`       | Opens the pause menu during a match, and resumes from it.                                                                 |
| `mute`              | `M`                | Toggles mute, on any screen.                                                                                              |

Either side's up/down action moves a menu selection, so the menus answer to
`W`/`S` and `↑`/`↓` alike. `Esc` drives **two** actions — `pause` and `back` —
and each screen reads the ones it calls for: on a live match only `pause` is
read, so one `Esc` opens the pause menu and leaves it open, and on the pause
menu both are read and either resumes, so one `Esc` resumes once. `P` opens the
pause menu and closes it again just as `Esc` does.

**The menus also take a mouse and a finger.** Moving the pointer onto an item
highlights it, and pressing and releasing inside that same item accepts it; a
press that slides off onto another item, or off the menu entirely, accepts
nothing. A touch contact behaves the same, except that a finger does not hover,
so the landing itself highlights the item it lands in. Each item's hit region is
a row-wide box laid out in `src/menus.ts`, which is the same description
`src/render.ts` draws the items from and the debug surface reports through
`menuItemRect`.

The **backtick** key (`` ` ``) toggles the engine's debug overlay. That key
belongs to the engine, not to this game.

**Spin:** swing your paddle (hold a movement key) as it strikes the ball to curve
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
- **The state, by value.** The engine holds `CaromState` as a value and hands it
  out as a `DeepReadonly` view: `update` is given the current state and returns
  the next one, the engine stores what it returned, and `render` draws that.
  `engine.state` is the current value, and `engine.apply(transition)` replaces
  it with what a transition returns — which is how a scenario is posed between
  frames.
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

Nothing in this build writes to a state it was handed. Every field of
`CaromState` is `readonly` and every array in it is a `readonly` array, so the
declared type and the `DeepReadonly` view the engine hands out are the same
shape, and every function over the state is a **transition**: the current state
(or a slice of it) in, the next one out, built by spreading what it keeps around
what it changes. `update` is the transition the engine runs every frame;
`startMatch`, `respawn`, `toTitle`, `serveBall`, `recordTrail`, and the debug
surface's poses are the ones it is composed from. The slice-level arithmetic
follows the same shape — `integratePaddle(paddle, vy, dt)` returns the next
paddle, `aiPaddle(...)` the next AI paddle,
`step(ball, left, right, obstacles, dt)` the ball after its flight beside the
events it saw, and `drawServeSign()` the sign a parked ball's serve will take.
There is no module-level game state and no closure over mutable
data; `render` and every diagnostic source are reads of the state they are
given, and the compiler — not a convention — is what says they cannot change it.

## Debugging and automation

The game exposes a small debugging and automation API **through the engine**, so a
scenario can be posed in Carom's own world from code. `src/debug.ts` builds the
surface, `initialize` returns it beside the state as
`[state, createDebugApi()]`, and a caller reads that same object back off
**`engine.debug`** — the engine returns it unchanged and reads no member of
it. Nothing is published on the page, so a check reaches the surface through the
engine it constructed rather than through the document the build is drawn on.

The surface holds no state, because the engine hands none out: every operation
is written in the shape of `update`. A **pose** takes the current state and
returns the next one, and a caller drives it through `engine.apply`; a
**reading** takes the state and returns what it read, and a caller hands it
`engine.state`:

```ts
engine.apply((s) => engine.debug.setScreen(s, "countdown"));
engine.apply((s) => engine.debug.setBallHoldTimer(s, 0));
await engine.advance(1); // the launch, through the build's own serve
engine.apply((s) => engine.debug.setBallPosition(s, 300, 360));
engine.apply((s) => engine.debug.setBallVelocity(s, 400, 0));
await engine.advance(30);
const { ball } = engine.debug.snapshot(engine.state);
```

**Every operation is atomic.** Each one sets one field, or one fixed pair of
fields, or places or removes one entity, or reads the state; none of them takes
a patch object and merges it, and none arranges several unrelated things at
once. `reset` is the one exception, and it is a lifecycle verb rather than a
pose. The operations are:

- The world — `clearWorld(state)`, `spawnBall(state)`,
  `spawnObstacle(state, index)`, and `reset(state)`. An
  absent ball takes no part in a frame and an absent obstacle has no collision,
  so a scenario can empty the field and put back only what it is about.
- Screens and menus — `setScreen`, `setMode`, `setMenuIndex`, `setTitleIndex`,
  and `setResumeScreen`, each setting its own field alone.
- The match — `setScore(state, p1, p2)`, `setWinner(state, side)`, and
  `setReceiver(state, side)`. The win rule still resolves through real play.
- The paddles — `setPaddleCy`, `setPaddleVy`, and `setPaddleDriven`, each taking
  a side. Driving one side leaves the other with its player or the AI, and
  `drivenVy` (the velocity a driven paddle moves at) and `vy` (the velocity the
  last frame integrated) are two separate fields.
- The ball — `setBallPosition`, `setBallVelocity`, `setBallSpin`, `setBallHeld`,
  and `setBallHoldTimer`.
- The AI — `setAiTracking(state, enabled)` and `setAiMovement(state, enabled)`,
  the two faculties gated one at a time, so a check can watch a blind opponent
  hold station or a seeing one refuse to move.
- Audio — `setMuted(state, muted)`, the mute bit the `mute` action toggles. The
  state carries it and `update` brings the engine's bus into line with it.
- The readings — `snapshot(state)`, a JSON-serializable view of the whole
  declared state, and `menuItemRect(state, index)`, the hit region of a menu
  item in logical units, which is the same layout `src/render.ts` draws from.

Every one of those is a read or a pose of `CaromState`: they arrange the world,
and the game's own `update` is what runs from there when the engine advances a
frame.

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
`engine.advance` against a `ConstantClock`, poses it through `engine.apply`, and
reads the result back from `engine.state`, the engine's events, and the pixels
the render produced. No browser is involved. The unit tests beside each module
call its transitions directly and assert on what they return.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: palette, type, HUD layout, copy
  debug.ts            The debug surface: poses and readings over CaromState,
                      returned beside the state by game.ts's initialize
  game.ts             The state contract, the state machine, and the three
                      functions the engine drives
  match.ts            Building the state and the transitions between screens,
                      shared by the menus and the debug surface
  random.ts           The serve sign draw a parked ball takes
  entities.ts         Paddle, ball and obstacle arithmetic and geometry
  menus.ts            Where each menu item is: the layout render.ts draws from
                      and debug.ts reports through menuItemRect
  trail.ts            The ball's motion trail, a fixed slice of time
  physics.ts          Delta-time integration, collision, the spin mechanic
  ai.ts               The beatable AI opponent
  render.ts           All canvas drawing, in logical space
  diagnostics.ts      The values the engine's overlay shows, each a read of
                      the state it is handed
  audio.ts            The four engine cues
  *.test.ts           The build's own tests, beside the code they cover
```
