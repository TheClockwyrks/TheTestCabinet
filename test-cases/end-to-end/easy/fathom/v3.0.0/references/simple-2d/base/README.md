# Fathom — `simple-2d` reference implementation

The authored, **correct** reference build of the Fathom end-to-end test case's
`base` variant, on the
[Simple 2D](../../../../../../../../packages/simple-2d) engine. Fathom supports
three engines and ships one reference build per engine and variant, so this is
the answer a run on `simple-2d` is shown. It is **never seeded into a run** —
handing a model the finished game would defeat the test — and takes no part in
the case's seed set. The case specs under `../../../specs/` remain authoritative
for the design.

The project is the case's seeded workspace
(`../../../workspaces/base/simple-2d/`) with `src/game.ts` implemented and its
own tests written beside it, so what is here is exactly what a run on this
engine is asked to produce.

---

**Fathom** is a bioluminescent deep-sea maze chase for the browser. You are a
small glowing forager threading the flooded corridors of a pitch-dark trench,
grazing plankton while three predators hunt you. The maze is unseen until your
own light or a sonar pulse touches it, so a dive is as much about sensing where
the danger is as about outswimming it.

Each hunter answers to a different signal you give off. The **Lanternjaw**
follows your light and wears a jellyfish's disguise while it drifts. The
**Gloamfin** is eyeless and sweeps the corridors with sonar of its own, faster
than you in a straight line and slower out of a corner. The **Flarefish** shows
nothing at all between the flares it casts, and the flash of one is both a light
and a sense.

The bioluminescence-in-the-abyss look is this build's own choice: the
specification fixes what a player must be able to read at a glance and leaves the
palette, the type and the composition to the build, so they live in
`src/theme.ts` rather than beside the case-fixed figures in `src/constants.ts`.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play ships in the built bundle.

## The dive

A maze holds one plankton on every corridor tile. Graze them all and you descend
a depth; each depth deepens the roster, up to two of each hunter, and shortens
your sonar's reach. Contact with any predator costs a life, and a dive opens with
three in reserve.

Eating brightens you, and brightness cuts both ways: it widens the pocket of
maze your own light shows you, and it widens the range at which the Lanternjaw
and the Flarefish can pick you out.

## Controls

Every control is a **registered engine action** on the `dpad-4-two-buttons`
touch layout, bound to these keys:

| Action           | Keys               | Does                                                              |
| ---------------- | ------------------ | ----------------------------------------------------------------- |
| `up` / `down`    | `↑` `↓`, `W` `S`   | Swims the forager, and moves a menu selection.                    |
| `left` / `right` | `←` `→`, `A` `D`   | Swims the forager.                                                |
| `a`              | `Space`            | Emits a sonar pulse.                                              |
| `b`              | `Shift`            | Releases an ink cloud.                                            |
| `confirm`        | `Enter` or `Space` | Accepts the selected menu item.                                   |
| `back`           | `Esc`              | Leaves how-to-play, resumes from the pause menu, quits game-over. |
| `pause`          | `P` or `Esc`       | Pauses live play.                                                 |
| `mute`           | `M`                | Toggles the sound, on any screen.                                 |

`Space` drives **two** actions — `a` and `confirm` — and `Esc` drives `back` and
`pause`; each screen reads the one its own row of `specs/movement.md` gives it,
so one key does one thing wherever you are.

The **backtick** key (`` ` ``) toggles the engine's debug overlay. That key
belongs to the engine, not to this game.

**Sonar** floods the corridors around you, bending at bends, revealing what it
reaches and marking the Gloamfin and the Flarefish standing in it. It is heard:
a Gloamfin the front reaches takes a fix on you. **Ink** blinds the two hunters
that see, and does nothing at all to the one that listens.

**The amber lights.** A bonus drifter and a wandering Lanternjaw are drawn as the
same amber mote, on the same drift, at any distance and through rock. One is
worth two hundred points and the other costs a life, and nothing but swimming
close enough to see what hangs beneath the bell tells them apart.

## What the engine owns

`@clockwyrks/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here:

- **The frame loop and its delta time.** `update(state, api, dt)` receives the
  real elapsed **seconds** of the frame. Fathom's own simulation runs on the
  fixed timestep `specs/movement.md` fixes, so `src/simulate.ts` advances the
  whole ticks that delta completes and carries the remainder into the next
  frame; how much one frame's delta may be worth is the clock's to bound.
- **The state, by value.** The engine holds `FathomState` as a value and hands it
  out as a `DeepReadonly` view: `update` is given the current state and returns
  the next one, the engine stores what it returned, and `render` draws that.
  `engine.state` is the current value, and `engine.apply(transition)` replaces it
  with what a transition returns — which is how a scenario is posed between
  frames.
- **The canvas fit.** The uniform scale, the centered letterbox, the device pixel
  ratio, and the resync when any of them changes. `src/render.ts` draws in
  logical `1280x720` coordinates and never reads the canvas element's size.
- **Input.** Named actions over `KeyboardEvent.code` bindings, with edge
  detection done once and correctly.
- **Audio.** The Web Audio graph, cue synthesis, mute, and the first-gesture
  unlock. The game declares seven cues and plays them by name.
- **Asset loading.** Every frame under `assets/` is fetched and decoded through
  the engine's loader, which resolves each path under the fixed `assets/` root
  and against the page the build is served from, so the produced site works at a
  server's root and under a sub-path alike.
- **The debug overlay.** The panel, the toggle key, and its read-only-ness; the
  game only names the values it shows.

What is left is the game: the simulation, the drawing, and the state the debug
surface poses.

## The state is a value

Nothing in this build writes to a state it was handed. Every field of
`FathomState` is `readonly` and every array in it is a `readonly` array, so the
declared type and the `DeepReadonly` view the engine hands out are the same
shape, and every function over the state is a **transition**: the current state
(or a slice of it) in, the next one out, built by spreading what it keeps around
what it changes. `update` is the transition the engine runs every frame, and it
is composed from the ones in `src/flow.ts` and `src/simulate.ts`. The
slice-level arithmetic follows the same shape — `moveBody(body, request)` returns
the body after one step of travel, `stepPredator(...)` the predator after one
step of its own mind beside the wavefronts and cues it raised, `advancePulse(...)`
the wavefront beside the tiles its front swept over, and `nextRandom(state)` the
draw beside the generator's next state.

There is no module-level game state in this build and no closure over mutable
data, which is what makes `reset` enough to replay a scenario exactly: the
generator's whole state is the single `rngState` field, and the loaded art is the
only thing a reset carries across. `render` and every diagnostic source are reads
of the state they are given, and the compiler — not a convention — is what says
they cannot change it.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes **through the engine**, so a scenario can be posed in Fathom's own trench
from code. `src/debug.ts` builds the surface, `initialize` returns it beside the
state as `[state, createDebugApi()]`, and a caller reads that same object back off
**`engine.debug`** — the engine returns it unchanged and reads no member of it.
Nothing is published on the page.

The surface holds no state, because the engine hands none out: every operation is
written in the shape of `update`. A **pose** takes the current state and returns
the next one, and a caller drives it through `engine.apply`; a **reading** takes
the state and returns what it read, and a caller hands it `engine.state`:

```ts
engine.apply((s) => engine.debug.setScreen(s, "playing"));
engine.apply((s) => engine.debug.setMaze(s, rows));
engine.apply((s) => engine.debug.clearPredators(s));
engine.apply((s) => engine.debug.clearDrifters(s));
engine.apply((s) => engine.debug.clearPlankton(s));
engine.apply((s) => engine.debug.setForagerTile(s, 5, 6));
engine.apply((s) => engine.debug.addPredator(s, "gloamfin", 10, 6));
engine.apply((s) => engine.debug.setPredatorState(s, 0, "chase"));
await engine.advance(120);
const { predators } = engine.debug.snapshot(engine.state);
```

The operations are `reset`, `snapshot`, `setScreen`, `setScore`, `setLives`,
`setDepth`, `setMaze`, `setPlankton`, `clearPlankton`, `clearFog`,
`setForagerTile`, `setForagerDir`, `setBrightness`, `setBrightHold`,
`clearPredators`, `addPredator`, `setPredatorTile`, `setPredatorDir`,
`setPredatorState`, `setPredatorReleased`, `setPredatorMind`,
`setPredatorTravel`, `spawnDrifter`, `clearDrifters`, `setDrifterMind`,
`setDrifterTravel`, `setSonarCooldown` and `setInkCooldown`.

**Each pose sets one thing** and leaves the rest of the trench as it stands, so a
caller that wants several things arranged makes several calls, in the order it
wants them, and nothing it did not ask for happens. That is what lets a caller
stand the game in a world holding only what it is about, as the snippet above
does: clear the predators, the drifters and the plankton, then add back exactly
the one hunter under test. The removals are real — a cleared predator is gone
from the simulation rather than parked out of the way.

Every operation is a read or a pose of `FathomState`: they arrange the trench,
and the game's own sensing, pathfinding, release schedule and contact rules are
what run from there when the engine advances a frame. A predator is selected by
its **index** into the snapshot's `predators` list, which is fixed to release
order, with an added predator at the end; a drifter by its index into `drifters`.

Everything about _driving a browser game_ rather than about Fathom is the
engine's. The clock, the exact frames, and the registered actions are driven by
constructing an engine directly (which is what `src/engine.test.ts` does), so the
surface deliberately carries no clock operation, no key operation, and no overlay
operation. A check that wants the frames a scenario drew arms the engine's
draw-command recorder around that section and keeps the recording.

The surface is inert during normal play.

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
same package at `.vendor/engine/@clockwyrks/simple-2d/` instead, so the import in
the sources is the same either way.

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
Serve that directory as-is from any static file server:

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
`engine.advance` against a `ConstantClock` at the simulation's own rate, poses it
through `engine.apply`, and reads the result back from `engine.state`, the
engine's events, and the pixels the render produced. No browser is involved, and
the host cannot fetch or decode the seeded art, so those checks exercise the same
fallback drawing a browser with a missing file would take. The unit tests beside
each module call its transitions directly and assert on what they return.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/)
vitest.config.ts      The build's own test suite, over src/
assets/               The seeded art: seven sprite sheets, one PNG per frame
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: palette, type, HUD layout, copy
  state.ts            The observable state, exactly as specs/state.md declares it
  game.ts             The state contract, the controls, and the three functions
                      the engine drives
  flow.ts             Laying a maze out, opening it, a life lost, the descent
  simulate.ts         The fixed-step tick: the whole simulation, one step at a time
  debug.ts            The debug surface: poses and readings over FathomState,
                      returned beside the state by game.ts's initialize
  snapshot.ts         The plain, JSON-serializable projection the surface reads
  rng.ts              The seeded generator: a draw beside the next state
  grid.ts             The tile grid: directions, centers, indices, distances
  maze.ts             A layout loaded, the tile queries, the flood, the pathfinding
  maze-rules.ts       Every rule of specs/maze.md, as measurements
  maze-generator.ts   A conforming maze, laid out off the generator
  entities.ts         Tile-locked travel, shared by everything that swims
  predators.ts        The den schedule, the three senses, the tells, the steering
  sensing.ts          The fog of war, line of sight, the light, the flare's disc
  sonar.ts            The wavefront: cast, advanced, and handed over bucket by bucket
  ink.ts              The cloud: released, aged, and what it blinds
  render.ts           All canvas drawing, in logical space
  diagnostics.ts      The values the engine's overlay shows, each a read of the
                      state it is handed
  audio.ts            The seven engine cues
  input.ts            The ten engine actions, and the desired direction
  assets.ts           Loading every frame of every seeded sheet
  *.test.ts           The build's own tests, beside the code they cover
```
