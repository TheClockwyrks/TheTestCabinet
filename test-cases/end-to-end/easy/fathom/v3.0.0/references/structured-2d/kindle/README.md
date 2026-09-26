# Fathom — `structured-2d` reference implementation

The authored, **correct** reference build of the Fathom end-to-end test case's
`kindle` variant, on the
[Structured 2D](../../../../../../../../packages/structured-2d) engine. It is the
answer a run on `structured-2d` is compared against. It is **never seeded
into a run** — handing a model the finished game would defeat the test — and
takes no part in the case's seed set. The case specs under `../../../specs/`
remain authoritative for the design.

The project is the case's seeded workspace with `src/game.ts` implemented, the
game split across new modules beside it, and its own tests written alongside, so
what is here is exactly what a run on this engine is asked to produce.

---

**Fathom** is a bioluminescent deep-sea maze chase, played in the browser. The
player is a small glowing forager threading the flooded corridors of a
pitch-dark trench, grazing plankton while three kinds of predator hunt it. The
maze is unseen until the forager's own light or a sonar pulse touches it, so a
dive is as much about sensing where the danger is as about outswimming it.

The **Kindle** dive adds the one thing that names it: an outer **vision circle**
the forager carries, `192` logical units across at rest and widening to `320` at
full brightness. It reveals nothing. The trench is explored and remembered
exactly as in the Standard dive, and the circle only decides how much of that
map is **drawn**: everything beyond it is painted with the same flat fog as
ground never touched, still remembered underneath and drawn again the moment
the forager returns. The hunters are not governed by it — they answer to the smaller light
pocket, a sonar mark, a flare and their own alerts — and three things show past
the blackout: a flare's bloom, the forager's own sonar wavefront, and a
Gloamfin's ping. So a flare is a second window onto the maze, and a pulse is the
only reach the forager has beyond its own circle.

Fathom's defining idea is **hunting in the dark**. Every tile is unrevealed
until something lights it; a tile a source has left stays remembered, dim, and
the rest stays black. Each predator hunts a different signal the forager gives
off, so what keeps the player alive against one gets them caught by another:

- **The Lanternjaw** hunts light, in a straight line, out to a range that grows
  with the forager's brightness. Undetected it drifts at a bonus drifter's pace
  wearing the drifter's own art, and it carries an amber bulb — clipped, like
  every amber light, to the vision circle — so a glimmer that drifts into the
  circle could be dinner or death, and a sonar pulse never resolves which.
- **The Gloamfin** is eyeless and hunts sound. It sweeps the corridors with
  sonar of its own, hears the forager's pulse, and hears it outright within two
  tiles. It opens a chase faster than the forager, and every corner it turns
  costs it that edge, so the way out is to keep turning. Ink does nothing to it.
- **The Flarefish** shows nothing of itself between the flares it casts. A flare
  charges, blooms a six-tile disc of light straight through rock, and locks on
  anything inside it — but the bloom lights the maze for the player too, ground
  never explored included, and it draws over the blackout, so a flare across the
  trench is a window the player did not have to swim to.

The forager answers with two abilities on their own cooldowns: a **sonar pulse**
that floods the corridors as a travelling wavefront, bending at bends and
marking the hunters it sweeps over — and carrying the sound to any Gloamfin it
reaches — and an **ink cloud** that blinds the two hunters that see.

The abyss look — near-black water, cold cyan light, one warm amber for both of
the maze's amber lights — is this build's own: the specification fixes the rules
and the geometry and deliberately leaves the palette, type, and screen
composition to the build, so the look lives in `src/theme.ts` rather than beside
the case-fixed figures in `src/constants.ts`. The creatures, the maze tiles and
the flare bloom are drawn from the sprite sheets seeded under `assets/`.

This is a self-contained static web app — plain **TypeScript** inside the
engine's gameplay framework, drawing to an **HTML5 canvas**, bundled with
**Vite**. No backend, accounts, network calls, or API keys; everything needed to
play is in the built bundle.

## Controls

Keyboard only. Every control is a **registered engine action** on the
`dpad-4-two-buttons` touch layout, and each screen reads only the actions its
own row of `specs/movement.md` names — which is how `Space` fires the pulse in
play and accepts a menu item everywhere else.

| Action                           | Keys               | Does                                                   |
| -------------------------------- | ------------------ | ------------------------------------------------------ |
| `up` / `down` / `left` / `right` | Arrows or `WASD`   | Steers the forager while held; moves a menu highlight. |
| `a`                              | `Space`            | Emits a sonar pulse.                                   |
| `b`                              | `Shift`            | Releases an ink cloud.                                 |
| `confirm`                        | `Enter` or `Space` | Accepts the highlighted menu item.                     |
| `back`                           | `Esc`              | Leaves the current screen.                             |
| `pause`                          | `Esc` or `P`       | Pauses live play.                                      |
| `mute`                           | `M`                | Toggles sound, on any screen.                          |

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows
the screen and depth, the score and lives, the brightness with both the light
radius and the vision circle's radius, the two cooldowns, the plankton
remaining, the forager's tile and facing, and one line per predator. That key
belongs to the engine, not to this game.

## What the engine owns

`@clockwyrks/structured-2d` is a gameplay framework as much as a runtime, and
none of what it owns is written here: the frame loop and its replaceable clock,
the construction and ticking of the framework objects in a fixed order, the
rendering pipeline and the camera, the canvas fit (uniform scale, centered
letterbox, device pixel ratio), named keyboard actions read through a player
controller with consume-on-read edges, audio cue synthesis with mute and the
first-gesture unlock, asset loading under the fixed `assets/` root, and the
debug overlay. What is left is the game: the maze, the fog of war and the light,
the tile-locked movement, the three predators, the wavefronts, the ink, the
screens, the HUD, and the state the debug surface poses.

## One world, one live state

The game is a single `GameDefinition` with a single level, opened once and never
left: every screen is a value of `state.screen`. `FathomMode` names
`FathomState` — the class `specs/state.md` declares, extending the engine's
`GameState` — as its `gameStateClass`, so `engine.world.state` is the one live
instance and the whole of the authoritative game. The framework's states are
live objects: the player controller resolves each frame's actions straight onto
it, the mode's tick runs the fixed-step clock over it, and the debug surface's
poses arrange it at the call. Nothing lives in a module-level variable or a
closure; the actors, components, and controller hold no authoritative state of
their own.

The mode's `beginPlay` adds **one player possessing nothing** — the forager is a
field of the state rather than a pawn — and that player's controller,
`FathomController`, is the one place input is read. The mode never calls
`setPhase`, so the inherited match `phase` stays `"waiting"` and Fathom's screens
run on `screen` alone. The camera is left at rest, so world units and the stage's
1280x720 logical units coincide; the level's one actor, the `Trench`, carries six
`DrawComponent`s — ground, effects, creatures, amber lights, HUD, screens — whose
draws are pure reads of the state through `src/render.ts` and whose overlap order
is the pipeline's layer sort.

The simulation runs on a **fixed timestep** of 120 steps a second, built over the
delta the engine hands each frame: the mode accumulates that delta and advances
by the whole ticks it completes, carrying the remainder, so the number of ticks
run over an interval of game time is the same however that interval was divided
into frames.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: the instance's `initialize` returns it, the engine
holds it, and a caller reads that same object back off **`engine.debug`**.
Nothing is published on the page.

Every operation acts on the live world at the moment it is called:

```ts
engine.debug.setScreen("playing");
engine.debug.setMaze(rows); // any fixture, exempt from the maze rules
engine.debug.clearPlankton();
engine.debug.clearPredators();
engine.debug.setForagerTile(4, 9);
engine.debug.addPredator("gloamfin", 12, 9);
engine.debug.setPredatorState(0, "chase");
await engine.advance(240);
const { predators, windowRadius } = engine.debug.snapshot();
```

The operations are `reset`, `snapshot`, `setScreen`, `setScore`,
`setLives`, `setDepth`, `setMaze`, `setPlankton`, `clearPlankton`, `clearFog`,
`setForagerTile`, `setForagerDir`, `setBrightness`, `setBrightHold`,
`clearPredators`, `addPredator`, `setPredatorTile`, `setPredatorDir`,
`setPredatorState`, `setPredatorReleased`, `setPredatorMind`,
`setPredatorTravel`, `spawnDrifter`, `clearDrifters`, `setDrifterMind`,
`setDrifterTravel`, `setDrifterIn`, `setSonarCooldown` and `setInkCooldown`.
Each is a single-field pose that feeds the same code path play feeds — a posed layout
is loaded by the code a descent loads one with, a posed predator hunts through
its own mind, and a posed chase takes its fix through the acquisition a sense
takes one through — so a scenario driven from code behaves exactly like one
played by hand. A caller that wants several things arranged makes several calls,
and nothing it does not ask for happens: the removal and placement pairs let a
scenario stand a world holding only what it is about, and the mind and travel
switches let it pose a creature with only the faculties it is about. Predators
and drifters are addressed by their index into the snapshot's own lists. Everything about
_driving a browser game_ — the clock, exact frames, key events — is the engine's,
which is why the surface carries no `step` and no `keyDown`. The surface is inert
during normal play.

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

The engine, `@clockwyrks/structured-2d`, is a relative `file:` dependency on
the repository's `packages/structured-2d`, which npm installs as a symlink, so
this project builds and tests against the engine's current source. A run receives
the same package at `.vendor/engine/@clockwyrks/structured-2d/` instead, so the
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
with `index.html` at its root and the seeded art copied under `dist/assets/`.
Every URL the running game requests resolves relative to the page, so the
directory serves as-is from a static file server at the server root or under a
sub-path of it:

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

`npm test` runs the build's own suite **in process**: it stands a real engine up
over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it with
`engine.advance` against a `ConstantClock` whose step is one simulation tick,
drives the keyboard by dispatching events at the surface's event target, poses
scenarios through the debug surface at `engine.debug`, and reads results back
from the world's state, the surface's snapshot, the engine's cue events, and the
pixels the render produced. No browser is involved. The harness also supplies the
two things Node lacks for the seeded art — a relative-path `fetch` and
`createImageBitmap` — so a headless run draws the same picture a browser does.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/)
vitest.config.ts      The build's own test suite, over src/
assets/               The seven seeded sprite sheets, one PNG per frame
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: the palette, the type, the layers
  game.ts             The FathomState contract, the game instance, the game
                      mode and its fixed-step tick, and the one-level definition
  controller.ts       The player controller: the one seat actions are read from
  grid.ts             Directions, the tile alphabet, tile-to-logical conversions
  layout.ts           The trench this build dives, its start tile and den slots
  maze.ts             The standing layout: tile queries, wrap-aware steps, the
                      corridor flood, the autotile mask, shortest-route steps
  maze-rules.ts       Every rule of specs/maze.md, as a measurement
  movement.ts         Tile-locked travel: turns at centers, reversals, the wrap
  fog.ts              The three visibility states, line of sight, the light
  sonar.ts            A wavefront as a moving front over the corridor flood
  ink.ts              The cloud, and the geometry that blinds a hunter
  creatures.ts        The forager, the drifters, the predators, and the roster
  predators.ts        The three minds: the den swim, each sense, each cadence
  flow.ts             The screens, the dive, and what a depth scales
  sim.ts              One tick of the whole game, on every screen
  debug.ts            The debug surface: poses and readings over the live world
  diagnostics.ts      The values the engine's overlay shows
  render.ts           All canvas drawing, in world units on the stage, the
                      vision-circle mask included
  trench.ts           The one actor and the six DrawComponents that render
  sprites.ts          The seeded sheets, loaded through the engine's loader
  audio.ts            The seven engine cues, played once per event per tick
  input.ts            The registered actions and the layout check
  fixtures.ts         The ASCII fixture stamper the tests pose boards with
  scenarios.ts        The fixtures and arrangements the tests share
  harness.ts          The in-process engine harness the build's tests run on
  *.test.ts           The build's own tests, beside the code they cover
```
