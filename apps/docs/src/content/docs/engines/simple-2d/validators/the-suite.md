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
    harness.ts
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
} from "@test-cabinet/simple-2d";
import { FIELD_H, FIELD_W } from "../src/constants";
import { game, type State } from "../src/game";
import type { Debug } from "./debug";

export interface Harness {
  engine: Engine<State, Debug>;
  canvas: Canvas;
  keys: EventTarget;
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

  return { engine, canvas, keys };
}
```

`@napi-rs/canvas` implements the 2D context natively, so the canvas is handed to
`createEngine` through a cast and the engine draws through it exactly as it
draws in a browser. The surface reports the logical design size at a device
pixel ratio of `1` by default, which puts one device pixel on one logical unit
and makes a sampled coordinate readable without arithmetic.

## Initialization order

`createEngine` is synchronous and runs no game code, so a suite subscribes to
[`engine.events`](/engines/simple-2d/apis/game/) before the game's own
`initialize` runs and observes what initialization did.

```ts
const { engine } = createHarness();
const failures: string[] = [];
engine.events.on("asset:failed", ({ path }) => failures.push(path));

const state = await engine.initialize();
await engine.advance(120);

expect(failures).toEqual([]);
```

`initialize` resolves to the state the game built, and `engine.state` exposes
the same live value. Every field of that state is present, so a check reads what
it wants without testing for a value that has yet to load.

Call `engine.destroy()` when a suite is finished with an engine, which drops the
listeners it attached and releases the canvas.

## The debug surface

A check poses its scenario through the surface the game returned beside its
state, read off `engine.debug` of the engine the suite constructed.

```ts
const { engine } = createHarness();
await engine.initialize();

engine.debug.startMatch("solo");
await engine.advance(90);

expect(engine.debug.snapshot().screen).toBe("playing");
```

The case's instrumentation spec states the surface's operations, so a scenario
reads the same way against every build. The suite declares its own type for
that surface from the spec, under `validation/`, and parameterizes the engine
with it, so `engine.debug` is the whole route from a check to the build's
implementation. A build whose surface departs from the spec fails the points
the checks decide.

## An unmet precondition

A suite sometimes cannot construct its scenario against a fully conformant build,
because the setup searched the world the build invented and found no place to pose
it. That says nothing about the build, so a suite reports it by skipping: a suite
whose checks were all skipped leaves its point unanswered for the reviewer to
decide by hand rather than failing it.

```ts
it.skipIf(corner === undefined)("rebounds out of a blind corner", () => {
  // …
});
```

A suite that skips only some of its checks still decides its point from the checks
that ran.

## The module contract

A suite imports the build, so a case fixes three module paths and what each one
exports. That contract is stated in the case's specification and is what gives
every build of the case the same shape to check.

| Module             | Supplied by | Holds                                                                                                                                           |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/constants.ts` | The case    | The logical design size, the palette, the action names with the keys they bind, the cue names, and every tunable the specification fixes.       |
| `src/game.ts`      | The build   | The `State` type the case declares and the `Game` the engine drives, whose `initialize` returns `[state, surface]` to the instrumentation spec. |
| `src/main.ts`      | The case    | The browser entry, which builds the engine over the page's canvas with a wall clock and runs it.                                                |

A suite imports `constants.ts` for the numbers and names its assertions are
stated in and `game.ts` for the game it drives. `main.ts` belongs to the built
page, and a suite constructs its own engine instead. The surface reaches a suite
only through `engine.debug`, typed by the suite's own declaration of the spec.

The build writes `game.ts` against the other two, and its `initialize` returns
the surface beside the state. It is free in where it implements the surface and
how it organizes everything else under `src/`, because the contract covers what
a check imports rather than how a build is structured.
