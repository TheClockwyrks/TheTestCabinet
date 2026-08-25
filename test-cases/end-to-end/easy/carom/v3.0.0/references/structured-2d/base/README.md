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

- **Two levels**, under the names `LEVELS` fixes. `title` hosts the title and
  how-to-play screens over a dimmed court; `match` hosts the countdown, the
  rally, the pause menu, and the match-over screen. Every way a match starts —
  SOLO or VERSUS on the title, RESTART, PLAY AGAIN — is one act: `world.open`
  on the match level, whose transition rebuilds the match fresh.
- **Two game modes.** `TitleMode` runs the menus; `MatchMode`
  (`src/match-mode.ts`) holds the match rules — the countdown and the serve,
  the goals, the win and deuce rules — and builds the match from its classes:
  player one on the left paddle, and the right paddle under a second player
  (Versus) or the AI bot (Solo).
- **Actors with components.** Each paddle is a `Paddle` **pawn** exposing one
  `drive(vy)` interface and integrating every request through the one
  integrator the spec fixes; the `Ball` actor runs the sub-stepped physics
  (`src/physics.ts`, pure) from its tick and plays the collision cues; the net,
  obstacles, HUD, and screen chrome are draw components ordered by the layer
  table in `src/theme.ts`.
- **Controllers.** `PaddleController` reads the held movement actions — and,
  as the primary seat, routes the frame's edges into its mode _before anything
  moves_, since controllers tick first. `AiPaddleController` computes the same
  drive from the world (`src/ai.ts`).
- **State in framework objects.** The game instance (`CaromGame`) carries what
  outlives a transition: the last mode, the seeded generator, and the debug
  driver's hold. Each world's game state carries its level's screens and match
  figures, with the two scores on the participants' player states. Nothing
  lives in a module-level variable.
- **Audio, input, rendering, the fit, the overlay** — all the engine's. The
  build defines the four `CUES` and registers the eight `ACTIONS` once, in
  `initialize`, and draws in logical 1280×720 coordinates.

## The debug and automation surface

`specs/instrumentation.md` fixes a surface for driving the game from code, and
this build implements it in `src/debug.ts`. The instance's `initialize` builds
the finished surface and **returns it**; the engine hands back exactly that
object from `engine.debug`, and that is the one way a caller reaches it.
Nothing is published on the page.

Every operation is a method acting on the **live world** through the same
systems play uses — it reads `engine.world` at the moment of the call, drives
the game mode, patches the tagged actors, or opens the level a menu choice
would open. A pose takes only its own arguments and returns nothing; a reading
takes none and returns plain data:

```ts
engine.debug.startMatch("versus");
engine.debug.setBall(0, { x: 300, vx: 400 });
await engine.advance(30);
const { ball } = engine.debug.snapshot();
```

The operations are `reset(options?)` and `snapshot()`; `startMatch(mode)`,
`serve()`, `setScore(p1, p2)`, `setPaddle(side, patch)`, and
`setBall(index, patch)` — each takes the paddles into the debug driver's hold,
until `reset` — and `setAiControl(enabled)`, which in Solo hands the right
paddle back to the real AI for the rest of a driven scenario.

`startMatch` opens the match level exactly as the menu does, so the transition
lands on the next advanced frame; a pose made in the meantime is held and
applied the moment the match's world has begun play, in call order, so the
spec's typical scenario — `startMatch`, then `setPaddle` and `setBall`, then a
few frames — reads back exactly what it posed.

Everything about _driving a browser game_ rather than about Carom is the
engine's: the scripted clocks and `engine.advance` own time, key events are
dispatched at the engine's input seam, `cue:played` reports the audio, and the
draw-command recorder is armed with `engine.startRecording()`. The surface
deliberately carries no operation for any of them.

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
  state.ts            The screen vocabulary and the two levels' game states
  levels.ts           The two level definitions and the shared furniture
  title-mode.ts       The title level: menu mode and its controller
  match-mode.ts       The match rules, and the player and AI controllers
  paddle.ts           The paddle pawn and its body
  ball.ts             The ball actor: physics tick, cues, trail, body
  scenery.ts          The net and the obstacles
  hud.ts              The scores and the mode label
  screens.ts          The title/how-to and countdown/pause/match-over chrome
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
