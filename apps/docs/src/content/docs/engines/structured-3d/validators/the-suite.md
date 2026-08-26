---
title: The Suite
---

A suite is a `.test.ts` file that imports the build, constructs an engine, and
makes its assertions against the framework that engine owns. Everything it needs
is reachable through ordinary module resolution, so a check is written the way
any other TypeScript test is written.

## Where the files live

A case keeps its Structured 3D validators in one directory of its version
folder, `validation/structured-3d/`, holding one `.test.ts` file per verdict
item and a shared harness module. The file path mirrors the item's id, so
`validation/structured-3d/gameplay/scoring-p1.test.ts` is the check behind the
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
    debug.ts
    gameplay/scoring-p1.test.ts
```

## The vitest project

The case's suites are a vitest project of their own, declared by a config the
case ships beside them rather than by the build's `vitest.config.ts`. The two
configs stay separate: the build's names `src/**/*.test.ts` and measures
coverage over `src/`, and the case's names `validation/**/*.test.ts` and
measures none.

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
had to keep a `validation` project in its own config could delete or narrow it,
and the verdict would quietly stop being decided; a build cannot reach the
verdict by writing a test, and a case's check cannot flatter the build's
coverage.

The environment is `node`. The engine takes every measurement it needs from the
surface the harness supplies, so the suites need no DOM.

## The harness

The harness builds an engine headlessly: a canvas from
`@test-cabinet/headless-webgl2`, which implements the WebGL2 context in
process. It is one of the repo's shippable packages — the case names it in its
manifest's `packages` key, seeding vendors it into the run repository under
`.tcab/packages/`, and the shipped workspace declares it as a development
dependency by the `file:` spec resolution requires. Beside the canvas sits a
[`SurfaceMetrics`](/engines/structured-3d/apis/engine/) object supplying the
size, the device pixel ratio, and the event target the engine listens on.

```ts
import { createCanvas, type Canvas } from "@test-cabinet/headless-webgl2";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type GameDefinition,
  type SurfaceMetrics,
} from "@test-cabinet/structured-3d";
import { FIELD_H, FIELD_W } from "../src/constants";
import { game } from "../src/game";
import type { Debug } from "./debug";

export interface Harness {
  engine: Engine<Debug>;
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

  const engine = createEngine<Debug>({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: FIELD_W,
    height: FIELD_H,
    game: game as GameDefinition<Debug>,
    clock,
    surface,
  });

  return { engine, canvas, keys };
}
```

`createEngine` takes the build's `GameDefinition` and returns an `Engine` whose
one type parameter is the debug surface, because the game's state lives in the
framework objects the engine owns and the surface is the one value the build
hands back. The headless canvas yields a WebGL2 context, so it is handed to
`createEngine` through a cast and the engine renders through it exactly as it
renders in a browser; a canvas that yields no WebGL2 context is the
construction error the engine names. The surface reports the logical design
size at a device pixel ratio of `1` by default, which puts one device pixel on
one logical unit and makes a sampled coordinate readable without arithmetic.

## Initialization order

`createEngine` is synchronous, performs no loading, and runs no game code, so a
suite subscribes to `engine.events` before anything the game does is observable
and sees the start level being built.

```ts
const { engine } = createHarness();
const failures: string[] = [];
const opened: string[] = [];
engine.events.on("asset:failed", ({ path }) => failures.push(path));
engine.events.on("world:opened", ({ level }) => opened.push(level));

const instance = await engine.initialize();
await engine.advance(120);

expect(failures).toEqual([]);
expect(opened).toEqual(["title"]);
```

`initialize` resolves once the game instance exists and has run its
`initialize`, the start level's `load` has resolved, its actors are spawned and
have begun play, and its game mode has begun play. It resolves to the instance,
and `engine.instance` is that same live object. Reading `engine.world`,
`engine.instance`, or `engine.debug` before it resolves throws an error naming
the ordering, so a suite awaits the call before it reads anything.

Call `engine.destroy()` when a suite is finished with an engine, which closes
the world, halts the loop, and drops the listeners it attached.

## The debug surface

A check poses its scenario through the surface the game instance's `initialize`
returned, read off `engine.debug` of the engine the suite constructed. Its
operations are methods that act on the live world: the instance holds `engine`,
and `engine.world` follows transitions, so a pose reads `this.engine.world` at
the moment of the call. A pose takes only its own arguments and returns nothing,
and a reading takes nothing and returns plain data, so a check drives both
directly.

```ts
const { engine } = createHarness();
await engine.initialize();

engine.debug.startMatch("solo");
await engine.advance(90);

expect(engine.debug.snapshot().phase).toBe("playing");
```

The case's instrumentation spec states the surface's operations, so a scenario
reads the same way against every build. The suite declares its own type for
that surface from the spec, under `validation/`, and parameterizes the engine
with it, so `engine.debug` is the whole route from a check to the build's
implementation. A build whose surface departs from the spec fails the points
the checks decide.

```ts
// validation/debug.ts — the surface as the case specifies it
import type { Vec3 } from "@test-cabinet/structured-3d";

export type Mode = "solo" | "versus";

export interface BallPatch {
  position?: Vec3;
  velocity?: Vec3;
}

export interface Snapshot {
  level: string;
  phase: string;
  score: { p1: number; p2: number };
  paddles: { left: { y: number; vy: number }; right: { y: number; vy: number } };
  ball: { position: Vec3; velocity: Vec3 };
}

export interface Debug {
  version: number;
  startMatch(mode: Mode): void;
  placeBall(patch: BallPatch): void;
  snapshot(): Snapshot;
}
```

A patch field is whole-for-whole: a `position` in the patch replaces the whole
`Vec3` on the actor's transform, so a pose that supplies one supplies all three
of its numbers, the same rule an `ActorSpec`'s `Partial<Transform>` follows.

## An unmet precondition

A suite sometimes cannot construct its scenario against a fully conformant
build, because the setup searched the world the build invented and found no
place to pose it. That says nothing about the build, so a suite reports it by
skipping: a suite whose checks were all skipped leaves its point unanswered for
the reviewer to decide by hand rather than failing it.

```ts
it.skipIf(spawn === undefined)("rebounds out of a blind corner", () => {
  // …
});
```

A suite that skips only some of its checks still decides its point from the
checks that ran.

## The module contract

A suite imports the build, so a case fixes three module paths and what each one
exports. That contract is stated in the case's specification and is what gives
every build of the case the same shape to check.

| Module | Supplied by | Holds |
| --- | --- | --- |
| `src/constants.ts` | The case | The design size, the arena dimensions in world units, the palette, the level names, the actor tag vocabulary, the action names with the keys they bind, the cue names, and every tunable the specification fixes. |
| `src/game.ts` | The build | The `GameDefinition` the engine drives, whose instance's `initialize` returns the debug surface to the instrumentation spec. |
| `src/main.ts` | The case | The browser entry, which builds the engine over the page's canvas with a wall clock and runs it. |

The contract is small because the engine's own object model is what a check
reads. A suite finds actors with `world.byTag`, reads the match through
`world.state`, drives a pawn by possessing it with a controller of its own, and
observes transitions on `engine.events`, so none of that has to be exported by
the build. The case fixes the tag vocabulary and the level names so that a check
names things every build of the case agrees on.

A suite imports `constants.ts` for the numbers and names its assertions are
stated in and `game.ts` for the definition it drives. `main.ts` belongs to the
built page, and a suite constructs its own engine instead. The surface reaches a
suite only through `engine.debug`, typed by the suite's own declaration of the
spec, and each of its operations acts on the world the engine holds.

The build writes `game.ts` against the other two, and its instance's
`initialize` returns the surface. It is free in where it implements the surface
and how it organizes everything else under `src/`, because the contract covers
what a check imports rather than how a build is structured.
