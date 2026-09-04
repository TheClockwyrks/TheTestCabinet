# Carom — `structured-2d` reference implementation

The authored, **correct** reference build of the Carom end-to-end test case's
`base` variant, on the
[Structured 2D](../../../../../../../../packages/structured-2d) engine. Carom
supports several engines and ships one reference build per engine, so this is
the answer a run on `structured-2d` is shown. It is **never seeded into a
run** — handing a model the finished game would defeat the test — and takes no
part in the case's seed set. The case specs under `../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace
(`../../workspaces/base/structured-2d/`) with `src/game.ts` implemented — and
the modules it grew beside it — and its own tests written beside the sources,
so what is here is exactly what a run on this engine is asked to produce.

---

**Carom** is a top-down paddle duel for the browser. Two paddles face each
other across a dark field; a ball ricochets between them, off the top and
bottom walls, and off a pair of fixed mid-field obstacles. A player scores when
the ball passes the far edge behind their opponent's paddle. The
neon-on-charcoal look is this build's own choice: the specification fixes the
rules and leaves the palette, type, and layout to the build, so they live in
`src/theme.ts` rather than beside the case-fixed figures in `src/constants.ts`.

Carom's defining mechanic is **spin**: the motion of a paddle at the moment it
strikes the ball curves the ball's flight afterward, so skilled play is about
shaping the ball's path, not just blocking it. The two fixed obstacles turn the
open field into a bank-shot puzzle.

This is a self-contained static web app — plain **TypeScript** inside the
engine's gameplay framework, drawing to an **HTML5 canvas**, bundled with
**Vite**. No backend, accounts, network calls, or API keys; everything needed
to play is in the built bundle.

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
| `pause`             | `P` or `Esc`       | Pauses during a match.                                                                                                    |
| `mute`              | `M`                | Toggles mute, on any screen.                                                                                              |

Either side's up/down action moves a menu selection, so the menus answer to
`W`/`S` and `↑`/`↓` alike. `Esc` drives **two** actions — `pause` and `back` —
and the game reads whichever the current screen calls for, so it pauses in a
match and steps back on a menu.

`P` and `Esc` both open the pause menu, and either one resumes it.

**The menus also take the mouse and touch.** Moving the pointer onto an item
selects it, and pressing and releasing inside that same item confirms it; a
touch contact that lands inside an item selects it, and lifting inside the same
item confirms. A press and a release in different items, or an edge outside
every item, confirm nothing.

The **backtick** key (`` ` ``) toggles the engine's debug overlay. That key
belongs to the engine, not to this game.

**Spin:** swing your paddle (hold a movement key) as it strikes the ball to
curve the shot. Up and down swings curve it opposite ways; a stationary paddle
imparts no spin, and imparted spin fades within a couple of seconds. Where on
the paddle you make contact sets the angle: the center sends the ball straight
across, the top or bottom edge sends it off at up to ~55°.

## How the game maps onto the engine

`@test-cabinet/structured-2d` supplies the gameplay framework the game is
written _inside_, and the build's own code is the subclasses:

- **One world hosts all six screens.** The debug surface's `setScreen` is an
  atomic pose — it sets the screen and leaves the scores, the world, and the
  menu indices as they are — so a screen cannot be a level. `CaromMode`
  (`src/carom-mode.ts`) therefore runs the title menu, the how-to page, the
  countdown, the rally, the pause menu, and the match-over screen over whichever
  world is open.
- **Two levels**, under the names `LEVELS` fixes, naming the two ways a world is
  _started_ rather than two halves of the state machine. `title` is the level
  the engine opens first and the level every path back to the title opens;
  `match` is the level SOLO, VERSUS, RESTART and PLAY AGAIN open. Each is one
  act — `world.open` — and each is an arrangement `specs/ui.md` fixes in full.
- **One game mode, in two openings.** `TitleLevelMode` and `MatchLevelMode`
  differ only in the pose they open on; everything else — the countdown and the
  serve, the goals, the win and deuce rules, and the menus under the keyboard,
  the mouse, and a finger — is shared.
- **Actors with components.** Each paddle is a `Paddle` **pawn** exposing one
  `drive(vy)` interface and integrating every request through the one integrator
  the spec fixes; the `Ball` actor runs the sub-stepped physics
  (`src/physics.ts`, pure) from its tick and plays the collision cues; the net,
  the HUD, and the screen chrome are draw components ordered by the layer table
  in `src/theme.ts`. The ball and the obstacles are spawned and destroyed rather
  than flagged, because _whether they are present_ is declared state — an absent
  ball is simply an actor that is not in the world.
- **Controllers.** One `PaddleController` per side. Which driver a seat listens
  to is decided per frame, because both `mode` and a paddle's `driven` flag are
  state a pose can change at any moment: a driven paddle follows the `drivenVy`
  held for its side, the left paddle follows the movement actions, and the right
  follows player two in Versus and the AI rule (`src/ai.ts`, pure) in Solo. The
  primary seat also carries `simTime` and routes the frame's edges into the mode
  _before anything moves_, since controllers tick first.
- **State in framework objects.** The game instance (`CaromGame`) carries what
  must survive a level transition — the remembered title selection, `simTime`,
  the seeded generator, the AI's two faculties, and the surface's hold on each
  paddle. The world's game state carries the screen, the mode, the two menu
  figures, the winner, and the receiver, with the two scores on the player
  states. The actors carry the field's bodies. Nothing lives in a module-level
  variable.
- **Audio, input, rendering, the fit, the overlay** — all the engine's. The
  build defines the four `CUES` and registers the eight `ACTIONS` once, in
  `initialize`, and draws in logical 1280×720 coordinates.

## The debug and automation surface

`specs/instrumentation.md` fixes a surface for driving the game from code, and
this build implements it in `src/debug.ts`. The instance's `initialize` builds
the finished surface and **returns it**; the engine hands back exactly that
object from `engine.debug`, and that is the one way a caller reaches it. Nothing
is published on the page.

Every operation is **atomic**: it sets one field or one fixed pair of fields,
places or removes one entity, or reads the state. There is no operation that
merges a patch and none that arranges several unrelated things at once, so a
scenario is a _sequence_ of them and a caller poses exactly the part of the
world it cares about. `reset` is the sole exception, and it is a lifecycle verb
rather than a pose: it restores every declared field at once.

A pose takes only its own arguments, returns nothing, and acts on the live world
through the same systems play uses; a reading returns plain data read off that
world at the instant of the call:

```ts
engine.debug.setScreen("countdown");
engine.debug.setPaddleDriven("left", true);
engine.debug.setPaddleVy("left", 300);
engine.debug.setBallHoldTimer(0); // ending the hold is what serving IS
await engine.advance(30);
const { ball } = engine.debug.snapshot();
```

| Group | Operations |
| --- | --- |
| The world | `clearWorld()`, `spawnBall()`, `spawnObstacle(index)`, `reset()`, `setSeed(seed)` |
| Screens and menus | `setScreen(screen)`, `setMode(mode)`, `setMenuIndex(index)`, `setTitleIndex(index)`, `setResumeScreen(screen)` |
| Match state | `setScore(p1, p2)`, `setWinner(side)`, `setReceiver(side)` |
| Paddles | `setPaddleCy(side, cy)`, `setPaddleVy(side, vy)`, `setPaddleDriven(side, driven)` |
| The ball | `setBallPosition(x, y)`, `setBallVelocity(vx, vy)`, `setBallSpin(spin)`, `setBallHeld(held)`, `setBallHoldTimer(seconds)` |
| The AI | `setAiTracking(enabled)`, `setAiMovement(enabled)` |
| Readings | `snapshot()`, `menuItemRect(index)` |

`snapshot()` reports every field an operation sets, so each one is verified by
setting a value and reading it back, and `menuItemRect(index)` reports the hit
region of a menu item in logical units — the build's own layout, reported, so a
caller can drive a pointer at it. Both leave the game as they found it. Because
no operation here crosses a level transition, every pose lands at the call.

Everything about _driving a browser game_ rather than about Carom is the
engine's: the scripted clocks and `engine.advance` own time, key and pointer
events are dispatched at the engine's input seam, `cue:played` reports the
audio, and the draw-command recorder is armed with `engine.startRecording()`.
The surface deliberately carries no operation for any of them.

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

The engine, `@test-cabinet/structured-2d`, is a relative `file:` dependency on
the repository's `packages/structured-2d`, which npm installs as a symlink, so
this project builds and tests against the engine's current source. A run
receives the same package at `.tcab/engine/@test-cabinet/structured-2d/`
instead, so the import in the sources is the same either way.

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

`npm test` runs the build's own suite **in process**: it builds a real engine
over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it
with `engine.advance` against a `ConstantClock`, poses it through
`engine.debug`, and reads the result back from the world's tagged actors, the
game state, the engine's events, and the pixels the pipeline produced. No
browser is involved. The unit tests beside each module call its pure functions
directly and assert on what they return.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: palette, type, layers, HUD, copy
  game.ts             The GameDefinition, and the CaromGame instance that
                      carries the cross-level state and returns the surface
  state.ts            The screen vocabulary and the world's game state
  levels.ts           The two level definitions and the shared field
  carom-mode.ts       The rules, the menus, and the paddle controller
  menu.ts             Each menu's items, layout, and hit regions
  paddle.ts           The paddle pawn and its body
  ball.ts             The ball actor: physics tick, cues, trail, body
  scenery.ts          The net and the obstacle actors
  hud.ts              The scores and the mode label
  screens.ts          The chrome for whichever of the six screens is up
  debug.ts            The debug and automation surface (specs/instrumentation.md)
  diagnostics.ts      The overlay sources
  physics.ts          The sub-stepped flight, collision, and spin (pure)
  sim.ts              The paddle/ball records and the one paddle integrator
  ai.ts               The AI's drive (pure)
  trail.ts            The trail window arithmetic (pure)
  audio.ts            The four cue definitions
  input.ts            Action registration and the input-reading helpers
  draw.ts             Shared canvas helpers for the draw components
  *.test.ts           The build's own tests, beside what they test
```
