---
title: The Suite
---

A suite is a `.test.ts` file that imports the build, constructs an engine, and
makes its assertions. Everything it needs is reachable through ordinary module
resolution, so a check is written the way any other TypeScript test is written.

## Where the files live

A case keeps its Simple 2D validators in one directory of its version folder,
`validation/simple-2d/`, holding one `.test.ts` file per verdict item and a
shared harness module. The file path mirrors the item's id, so
`validation/simple-2d/gameplay/scoring-p1.test.ts` is the check behind the
`gameplay/scoring-p1` item, and the item declares it as
`gameplay/scoring-p1.test.ts`, relative to this directory.

That directory is placed into the built workspace at `validation/` when the run
is validated, alongside the `src/` the build wrote. A suite therefore reaches
the build's modules with a relative import, and the engine by its package name.

```text
workspace/
  package.json
  vitest.config.ts
  src/            the build
  validation/     the case's suites
    constants.ts
    harness.ts
    debug.ts
    gameplay/scoring-p1.test.ts
```

## The vitest project

The case's suites are a vitest project of their OWN, declared by a config the
case ships beside them rather than by the build's `vitest.config.ts`. The two
configs never mix: the build's names `src/**/*.test.ts` and measures coverage
over `src/`, and the case's names `validation/**/*.test.ts` and measures none.

```ts
// validation/vitest.config.ts — the case's, staged in with the suites
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The workspace, not this directory, so a validator resolves the build's
  // modules by the same relative paths the build itself uses.
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
  },
});
```

The two suites are therefore two commands:

```sh
npx vitest run                                       # the build's own tests
npx vitest run --config validation/vitest.config.ts  # the case's validators
```

The config belongs to the case for the same reason the suites do. A build that
had to keep a `validators` project in its own config could delete or narrow it,
and the verdict would quietly stop being decided; a build cannot reach the
verdict by writing a test, and a case's check cannot flatter the build's
coverage.

The environment is `node`. The engine takes every measurement it needs from the
surface the harness supplies, so the suites need no DOM.

## The figures a check asserts

The project states its own figures in `constants.ts` at its root, transcribed
from the case's rendered specifications under the names those specifications
use. A suite imports each figure it asserts from there: `./constants` from the
project root, `../constants` from a suite one directory down.

```ts
// validation/constants.ts

/** The logical design size (specs/overview.md). */
export const FIELD_W = 1280;
export const FIELD_H = 720;

/** The paddle's travel speed, in units per second (specs/paddles.md). */
export const PADDLE_SPEED = 720;

/* ---- What the specification leaves to the build ------------------------- */
//
// Read to drive the build, never compared against. `specs/controls.md` requires
// a touch layout carrying the four movement actions and names none, so the
// layout the build registered is the build's own choice.

export { LAYOUT } from "../src/constants";
```

The build is seeded a `src/constants.ts` of its own, holding the same figures
under the same names. `constants.ts` is the only file in the project that
reaches that module, and it reaches it for the values the specification leaves
to the build, which a check reads to drive the build. A figure a check asserts is
transcribed instead: a figure read from the build asserts the build against
itself, which every build passes, including one whose paddle travels at some
other speed. The rule and the reasoning behind it are in
[Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/).

## The harness

The harness builds an engine headlessly: a canvas from `@napi-rs/canvas`, which
the case declares as a development dependency of the workspace, and a
[`SurfaceMetrics`](/engines/simple-2d/apis/engine/) object supplying the size,
the device pixel ratio, and the event target the engine listens on.

```ts
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type Game,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import { FIELD_H, FIELD_W } from "./constants";
import { game, type State } from "../src/game";
import type { Debug, Mode, Screen, Snapshot } from "./debug";

export interface Harness {
  readonly engine: Engine<State, Debug>;
  readonly canvas: Canvas;
  readonly keys: EventTarget;
  setScreen(screen: Screen): void;
  setMode(mode: Mode): void;
  setBallPosition(x: number, y: number): void;
  setBallVelocity(vx: number, vy: number): void;
  snapshot(): Snapshot;
}

export function createHarness(
  clock: Clock = new ConstantClock(1000 / 60),
  dpr = 1,
): Harness {
  const canvas = createCanvas(FIELD_W * dpr, FIELD_H * dpr);
  const keys = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => dpr,
    events: () => keys,
  };

  const engine = createEngine<State, Debug>({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: FIELD_W,
    height: FIELD_H,
    game: game as Game<State, Debug>,
    clock,
    surface,
  });

  return {
    engine,
    canvas,
    keys,
    setScreen: (screen) =>
      engine.apply((s) => engine.debug.setScreen(s, screen)),
    setMode: (mode) => engine.apply((s) => engine.debug.setMode(s, mode)),
    setBallPosition: (x, y) =>
      engine.apply((s) => engine.debug.setBallPosition(s, x, y)),
    setBallVelocity: (vx, vy) =>
      engine.apply((s) => engine.debug.setBallVelocity(s, vx, vy)),
    snapshot: () => engine.debug.snapshot(engine.state),
  };
}

export function startMatch(h: Harness, mode: Mode): void {
  h.setMode(mode);
  h.setScreen("playing");
  h.setBallPosition(FIELD_W / 2, FIELD_H / 2);
  h.setBallVelocity(0, 0);
}
```

`@napi-rs/canvas` implements the 2D context natively, so the canvas is handed to
`createEngine` through a cast and the engine draws through it exactly as it
draws in a browser. The surface reports the logical design size at a device
pixel ratio of `1` by default, which puts one device pixel on one logical unit
and makes a sampled coordinate readable without arithmetic.

The members after `keys` wrap the debug surface over the engine. A pose on the
surface takes the current state and returns the next, so the harness hands it
to `engine.apply`; a reading takes the state, so the harness hands it
`engine.state`. A check then names the operation and nothing else.

Every operation the surface carries sets one element of the world, so the
sequences a scenario is opened with belong to the harness. `startMatch` is one
of them: it is written once, from the atomic operations, and every check that
needs a match under way calls it, while a check that needs only part of the
arrangement calls the operations it needs.

## Initialization order

`createEngine` is synchronous and runs no game code, so a suite subscribes to
[`engine.events`](/engines/simple-2d/apis/game/) before the game's own
`initialize` runs and observes what initialization did.

```ts
const { engine } = createHarness();
const failures: string[] = [];
engine.events.on("asset:failed", ({ path }) => failures.push(path));

await engine.initialize();
await engine.advance(120);

expect(failures).toEqual([]);
```

`initialize` resolves to the opening state the game built, and `engine.state`
reads the current one, the value the most recent frame left. Every field of
that state is present, so a check reads what it wants without testing for a
value that has yet to load.

Call `engine.destroy()` when a suite is finished with an engine, which drops the
listeners it attached and releases the canvas.

## The debug surface

A check poses its scenario through the surface the game returned beside its
state, read off `engine.debug` of the engine the suite constructed. The surface
holds no state: a pose is a transition the check drives through `engine.apply`,
and a reading is a function of `engine.state`.

```ts
const h = createHarness();
await h.engine.initialize();

startMatch(h, "solo");
h.setBallVelocity(240, 0);
await h.engine.advance(30);

expect(h.snapshot().ball.x).toBeCloseTo(FIELD_W / 2 + 120, 3);
```

The case's instrumentation spec states the surface's operations, so a scenario
reads the same way against every build. The suite declares its own type for
that surface from the spec, under `validation/`, and parameterizes the engine
with it, so `engine.debug` is the whole route from a check to the build's
implementation. A build whose surface departs from the spec fails the points
the checks decide.

```ts
// validation/debug.ts — the surface as the case specifies it
import type { DeepReadonly } from "ts-essentials";
import type { State } from "../src/game";

export type Mode = "solo" | "versus";
export type Screen = "title" | "countdown" | "playing" | "over";

export interface Snapshot {
  screen: Screen;
  mode: Mode;
  score: { p1: number; p2: number };
  paddles: { left: { cy: number; vy: number }; right: { cy: number; vy: number } };
  ball: { x: number; y: number; vx: number; vy: number };
}

export interface Debug {
  version: number;
  setScreen(state: DeepReadonly<State>, screen: Screen): State;
  setMode(state: DeepReadonly<State>, mode: Mode): State;
  setBallPosition(state: DeepReadonly<State>, x: number, y: number): State;
  setBallVelocity(state: DeepReadonly<State>, vx: number, vy: number): State;
  snapshot(state: DeepReadonly<State>): Snapshot;
}
```

Each operation sets one element of the world and takes scalars, so a check
arranges only what its requirement concerns and the build keeps its own state
layout. `snapshot` reports every field an operation sets, which is what lets a
check verify an operation by setting a value and reading it back.

## An unmet precondition

A suite whose checks all skipped reports an unmet precondition, and the point is
left undecided for a reviewer rather than failed. This is a capability of the
runner rather than a shape to author toward. A suite poses its own world through
the case's debug surface, removing what its requirement is not about and placing
what it is, so the setup has nothing to search for and every check reaches a
verdict; see
[Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/).

## The module contract

A suite imports the build, so a case fixes three module paths and what each one
exports. That contract is stated in the case's specification and is what gives
every build of the case the same shape to check.

| Module | Owned by | Holds |
| --- | --- | --- |
| `src/constants.ts` | The build | The build's copy of the logical design size, the palette, the action names with the keys they bind, the cue names, and every tunable the specification fixes. It is seeded with the workspace and the build imports it. |
| `src/game.ts` | The build | The `State` type the case declares and the `Game` the engine drives, whose `initialize` returns `[state, surface]` to the instrumentation spec. |
| `src/main.ts` | The case | The browser entry, which builds the engine over the page's canvas with a wall clock and runs it. |

A suite imports `game.ts` for the game it drives, and takes every figure it
asserts from the project's own
[`constants.ts`](#the-figures-a-check-asserts). `main.ts` belongs to the built
page, and a suite constructs its own engine instead. The surface reaches a suite
only through `engine.debug`, typed by the suite's own declaration of the spec,
and is driven through `engine.apply` and `engine.state`.

The build writes `game.ts` against the other two, and its `initialize` returns
the surface beside the state. It is free in where it implements the surface and
how it organizes everything else under `src/`, because the contract covers what
a check imports rather than how a build is structured.
