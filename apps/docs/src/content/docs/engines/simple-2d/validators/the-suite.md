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
`gameplay/scoring-p1` item.

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

The workspace's vitest config declares two projects, one over the build's own
tests and one over the case's suites.

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "game", include: ["src/**/*.test.ts"] } },
      {
        test: {
          name: "validators",
          include: ["validation/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
```

Validation runs `vitest run --project validators`, so the verdict rests on the
case's checks alone and a build's own test file cannot reach it. The build runs
`vitest run --project game` for itself.

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
  type SurfaceMetrics,
} from "@test-cabinet/simple-2d";
import { FIELD_H, FIELD_W } from "../src/constants";
import { game, type State } from "../src/game";

export interface Harness {
  engine: Engine<State>;
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

  const engine = createEngine<State>({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: FIELD_W,
    height: FIELD_H,
    game,
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

## The module contract

A suite imports the build, so a case fixes four module paths and what each one
exports. That contract is stated in the case's specification and is what gives
every build of the case the same shape to check.

| Module | Supplied by | Holds |
| --- | --- | --- |
| `src/constants.ts` | The case | The logical design size, the palette, the action names with the keys they bind, the cue names, and every tunable the specification fixes. |
| `src/game.ts` | The build | The `State` type the case declares and the `Game<State>` the engine drives. |
| `src/debug.ts` | The case | The scenario operations, each a function over `State`, that pose a situation through the same systems play uses. |
| `src/main.ts` | The case | The browser entry, which builds the engine over the page's canvas with a wall clock and runs it. |

A suite imports `constants.ts` for the numbers and names its assertions are
stated in, `game.ts` for the game it drives, and `debug.ts` for the scenarios it
arranges. `main.ts` belongs to the built page, and a suite constructs its own
engine instead.

The build writes `game.ts` against the other three. It is free in how it
organizes everything else under `src/`, because the contract covers what a check
imports rather than how a build is structured.
