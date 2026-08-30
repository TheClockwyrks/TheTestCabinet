# Coil — `structured-2d` reference implementation (Maze)

The authored, **correct** reference build of the Coil full-stack test case's
Maze variant, on the
[Structured 2D](../../../../../../../../packages/structured-2d) engine. It is the
answer a run on `structured-2d` is compared against. It is **never seeded into a
run** — handing a model the finished game would defeat the test — and takes no
part in the case's seed set. The case specs under `../../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace with `src/game.ts` implemented, the
game split across new modules beside it, its own tests written alongside, and the
art and sound it plays produced and committed, so what is here is exactly what a
run on this engine is asked to produce.

---

**Coil** is a neon grid serpent, played in the browser. One snake threads a
single continuous path across a bordered grid, eating pellets that make it a cell
longer each time, until a wrong turn runs it into a wall or into its own body.

Coil's own idea is the **combo**. Pellets eaten in quick succession build a
multiplier that lapses the moment you dawdle, so the strong player is the one who
plans an efficient route from one pellet to the next rather than the one who
merely survives.

The dark field with its bright, saturated pieces — the green coil, the warm
pellet, the amber bars — is this build's own: the specification fixes the rules
and the geometry and deliberately leaves the palette, the type, and the artwork
to the build, so the look lives in `src/theme.ts` rather than beside the
case-fixed figures in `src/constants.ts`.

Maze lays a fixed course of four bars across the interior. They are as fatal as
the wall border, no pellet ever spawns on one, and the row the snake starts on
carries none of them, so the opening chain has a clear runway ahead of it and the
route to every pellet after that has to work around the course.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawn by the engine's rendering pipeline, bundled with **Vite**. No backend,
accounts, network calls, or API keys; everything needed to play is in the built
bundle.

## Controls

The game is played from the keyboard alone. Every control is a **registered
engine action** on the `dpad-4` touch layout, and keys are named by their
physical `KeyboardEvent.code`, so the bindings hold whatever layout you type on.

| Action    | Keys                 | On the board          | On a menu                    |
| --------- | -------------------- | --------------------- | ---------------------------- |
| `up`      | `ArrowUp`, `KeyW`    | Turns the snake up    | Moves the highlight up       |
| `down`    | `ArrowDown`, `KeyS`  | Turns the snake down  | Moves the highlight down     |
| `left`    | `ArrowLeft`, `KeyA`  | Turns the snake left  | Nothing                      |
| `right`   | `ArrowRight`, `KeyD` | Turns the snake right | Nothing                      |
| `confirm` | `Enter`, `Space`     | Nothing               | Accepts the highlighted item |
| `back`    | `Escape`             | Pauses the round      | Leaves the screen            |
| `pause`   | `KeyP`               | Pauses the round      | Resumes, on the pause menu   |
| `mute`    | `KeyM`               | Toggles sound         | Toggles sound                |

A turn is buffered and takes effect on the next step, and the snake can only turn
across the way it is travelling, so it never doubles back on itself.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows
the screen, the score and the best score, the multiplier and the seconds left on
its window, the snake's direction, its length, its head cell, and the pellet
cell. That key belongs to the engine, not to this game.

## What the engine owns

`@test-cabinet/structured-2d` supplies everything that is the same in every
browser game, and none of it is written here: the frame loop and its delta time
in seconds, the canvas fit (uniform scale, centered letterbox, device pixel
ratio), the camera, named keyboard actions with edge detection, the audio cue bus
with looping, mute, and the first-gesture unlock, the asset loader the produced
files are read through, the debug overlay, and the **rendering pipeline** that
orders and calls every render component. What is left is the game: the round, the
screens, what each layer draws, the produced art and sound, and the state the
debug surface poses.

## The framework, and where the game sits in it

The game is one `GameDefinition` with **one level**, opened once and never left:
every screen is a value of `CoilState.screen`, so the world and its state live
for the whole session and starting a round is not a level transition. The pieces
are the framework's own:

| Piece               | Is                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `CoilInstance`      | Registers the actions, defines the four cues over the produced files, loads the sprite set, and returns the debug surface. |
| `CoilMode`          | Names `CoilState` as its `gameStateClass`, adds the one player, registers the diagnostics, and runs the fixed tick. |
| `CoilController`    | The one seat the registered actions are read from, one edge per frame.                       |
| `Arena`             | The one actor the level places; its two `DrawComponent`s are the board layer and the UI layer. |

## The fixed tick

The engine hands the game mode the real elapsed seconds of each frame and imposes
no timestep of its own. Coil advances in whole ticks of `TICK_SECONDS` (`0.125`,
so eight a second), so `CoilMode.tick` accumulates those seconds on the `playing`
screen and resolves each whole tick in the six-step order `specs/movement.md`
fixes, carrying the remainder. A second of game time is eight ticks whether it
arrived in one frame or in sixty, and drawing advances nothing.

Controllers tick before the game mode does, so a key pressed this frame is on the
turn buffer before the frame's ticks resolve: the press arrives, then the step it
steers.

## The state is one live object

`CoilState` extends the framework's `GameState`, and `engine.world.state` is the
one instance of it. The framework's states are **live**: a tick writes the fields
it advances in place, and each field initializer is that field's title-screen
value — the same value the debug surface's `reset` restores. Every value carried
from one frame to the next lives on it. Nothing authoritative is kept in a
module-level variable or a closure: the controller, the draw components, and the
diagnostic sources all read the state off the world at the call, so what is drawn
is the frame this tick produced.

The pellet generator is part of that: its whole state is one 32-bit word held in
`CoilState.rngState`, and each draw returns the next word beside its result, so
reseeding is assigning a number and replaying the same calls reproduces the same
pellet sequence exactly.

## Rendering, as two layers

The engine owns the pipeline, so this build states **what** to draw and leaves
the ordering and the transform to it. `Arena` holds two `DrawComponent`s — the
board layer at `layer` 0 and the UI layer at `layer` 1 — and each `draw` is a
pure read of the world's `CoilState` through `src/render.ts`. The context arrives
carrying the world-to-device transform, and the game leaves the camera at rest,
so every coordinate is a logical unit on the fixed `1280 x 720` stage.

The pipeline resets the transform between components and nothing else, so each
layer turns image smoothing off before it draws anything; the pixel art then
stays sharp at every scale the stage is fitted to.

## Debugging and automation

The game exposes the debugging and automation surface
`specs/instrumentation.md` fixes, **through the engine**: `src/debug.ts` builds
it, the game instance's `initialize` returns it, and a caller reads that same
object back off **`engine.debug`**. Nothing is published on the page.

Every operation acts on the live world at the call. A pose sets one thing and
returns nothing; a reading returns plain data:

```ts
engine.debug.setScreen("playing");
engine.debug.setSnake([
  { col: 10, row: 8 },
  { col: 9, row: 8 },
]);
engine.debug.setPellet(11, 8);
await engine.advance(8);
const { score, snake } = engine.debug.snapshot();
```

The operations are `reset` (seedable), `snapshot`, `setScreen`, `setMenuIndex`,
`setScore`, `setBest`, `setCombo`, `setComboWindow`, `setSnake`, `setDirection`,
`clearTurns`, `setPellet`, `clearPellet`, and the three driver switches
`setSnakeSteering`, `setSnakeTravel`, and `setPelletRespawn`. A pose sets one
thing and the game's own tick, turning, collision, pellet placement and scoring
run from there exactly as they do in play. Everything about _driving a browser
game_ — the clock, exact frames, key events — is the engine's, which is why the
surface carries no `advance` and no `keyDown`. It is inert during normal play.

Maze lays an obstacle course, so it carries two more operations for it:
`clearObstacles`, which takes every obstacle cell off the board at once, and
`addObstacle`, which puts one back on a named interior cell. The Classic variant
beside this one carries neither, because it lays no obstacle cell.

## The art and the sound

Coil ships no third-party art or audio. The snake's sprite set and the four
sounds are produced with the asset-generation tools and committed under
`assets/`, and the build bundles those committed files. It never runs the tools,
so the project builds wherever they are absent.

| File                        | Made with    | Is                                         |
| --------------------------- | ------------ | ------------------------------------------ |
| `assets/snake/head/0-3.png` | `draw-sheet` | The head at rest, and its three-frame bite |
| `assets/snake/body.png`     | `draw`       | A straight horizontal run                  |
| `assets/snake/corner.png`   | `draw`       | A bend, open east and south                |
| `assets/snake/tail.png`     | `draw`       | The last cell, connecting west             |
| `assets/audio/eat.wav`      | `sfx-synth`  | The pellet                                 |
| `assets/audio/combo-up.wav` | `sfx-synth`  | The multiplier rising                      |
| `assets/audio/death.wav`    | `sfx-synth`  | The end of a round                         |
| `assets/audio/music.wav`    | `music`      | The loop under a round                     |

Each is loaded through the **engine's** asset loader, under its one root, so the
build constructs no URL of its own. `public/assets` links that committed tree
into the static bundle, so `dist/assets/snake/body.png` is exactly where the
loader's root looks for it from the served page. A load that fails leaves the
game running: the sprite is simply missing and each cue falls back to the synth
shape `src/audio.ts` declared it with, so the game keeps its board, its rules,
and its input.

Regenerating them, when the tools are on the `PATH`:

```sh
bash scripts/gen-sprites.sh
bash scripts/gen-audio.sh
```

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
this project builds and tests against the engine's current source. A run receives
the same package at `.tcab/engine/@test-cabinet/structured-2d/` instead, so the
import in the sources is the same either way.

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
with `index.html` at its root. Every URL the build emits is page-relative, so
`dist/` runs as-is at the root of a static host and under a sub-path alike.

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

`npm test` runs the build's own suite **in process**, with no browser. Some of it
is arithmetic over the state — the tick, the turn buffer, the collision rules,
the combo, the pellet generator, and the screen routing — and the rest stands a
**real engine** up through `src/harness.ts`, over an `@napi-rs/canvas` canvas and
a `SurfaceMetrics` of its own, steps it with `engine.advance` against a
`ConstantClock`, drives the keyboard by dispatching events at the surface's event
target, poses scenarios through `engine.debug`, and reads results back from the
world's state, the debug surface, the engine's cue events, and the pixels the
pipeline produced. `src/render.test.ts` draws both layers through an
`@napi-rs/canvas` context to read back what a player sees.

## Layout

| Path                 | Holds                                                             |
| -------------------- | ----------------------------------------------------------------- |
| `src/constants.ts`   | Every figure the specification fixes. Supplied with the project.  |
| `src/main.ts`        | The entry point. Supplied with the project.                       |
| `src/game.ts`        | `CoilState`, the instance, the game mode and its tick, the level. |
| `src/controller.ts`  | The one seat the frame's actions are read from.                   |
| `src/flow.ts`        | The screens, and what one press edge does on each.                |
| `src/sim.ts`         | The round: one whole tick, in the six steps the spec fixes.       |
| `src/board.ts`       | The grid's geometry and the valid pellet set.                     |
| `src/mode.ts`        | What the mode this build ships means for the rest of it.          |
| `src/menus.ts`       | The items each menu-bearing screen holds.                         |
| `src/rng.ts`         | The seeded generator the pellet is drawn from.                    |
| `src/input.ts`       | The engine actions, registered and read one edge per frame.       |
| `src/audio.ts`       | The four cues, declared and played by name.                       |
| `src/assets.ts`      | The produced sprite set, loaded through the engine's loader.      |
| `src/arena.ts`       | The one actor, and the two draw components that render the game.  |
| `src/render.ts`      | What each of the two layers draws, in logical units.              |
| `src/draw.ts`        | The small text and rounded-rectangle helpers drawing shares.      |
| `src/theme.ts`       | The palette and the type — this build's own look.                 |
| `src/debug.ts`       | The debugging and automation surface.                             |
| `src/diagnostics.ts` | The values the engine's overlay shows.                            |
| `src/harness.ts`     | The real engine the build's own tests stand up.                   |
| `assets/`            | The produced sprites and sounds, committed and bundled.           |
| `scripts/`           | The generation scripts that produced them.                        |
