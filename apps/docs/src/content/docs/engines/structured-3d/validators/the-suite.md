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
`gameplay/scoring-p1.test.ts`, relative to this directory. Every `.test.ts` the
directory holds maps to an item that way, because a run loads exactly the suites
its variant's items name.

That directory is placed into the built workspace at `validation/` when the run
is validated, alongside `src/`, which holds the case's seeded modules and the
build's own. A suite therefore reaches the build's modules with a relative
import, and the engine by its package name.

```text
workspace/
  package.json
  vitest.config.ts
  src/            the build
  validation/     the case's suites
    vitest.config.ts
    harness.ts
    debug.ts
    replay.ts
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
import { defineConfig } from "vitest/config";
import type { BrowserCommand } from "vitest/node";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Writes a suite's recording under the run's media directory. Runs on the Node side. */
const emitReplay: BrowserCommand<[output: string, video: string]> = (
  { testPath },
  output,
  video,
) => {
  const dir = process.env.TCAB_VALIDATION_MEDIA_DIR;
  if (dir === undefined || testPath === undefined) return;
  const target = join(dir, relative(ROOT, testPath), `${output}.webm`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(video, "base64"));
};

export default defineConfig({
  root: ROOT,
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: { emitReplay },
    },
    passWithNoTests: false,
    coverage: { enabled: false },
    testTimeout: 60_000,
  },
});
```

The two suites are therefore two commands:

```sh
npx vitest run                                       # the build's own tests
npx vitest run --config validation/vitest.config.ts  # the case's validators
```

The config belongs to the case for the same reason the suites do: the case
alone decides which suites reach the verdict, and the build's own tests and
coverage stay separate from them. The root is the workspace rather than this
directory, so a validator resolves the build's modules by the same relative
paths the build itself uses, and `passWithNoTests` is `false` because a missing
validator is a broken suite rather than a passing one.

The project runs in browser mode. Playwright launches a headless Chromium, and
each suite runs in its page, where `document`, `HTMLCanvasElement`, WebGL2, and
WebCodecs are the browser's own. Chromium renders WebGL2 in software, so the
world pass produces its pixels with no GPU on the host. The Chromium is the one
the runner's browser driver uses, and a host without it fails the validation
stage.

`commands` is the seam between the page and the Node side. A suite calls
`emitReplay` from the page and the function runs in the vitest process with
the suite's path in hand, which is how a
[recording](/engines/structured-3d/validators/recording/) reaches the run's
media directory. The timeout is a minute per test because a suite that records
sixty frames encodes sixty video frames in software before it resolves.

## The harness

The harness builds an engine over two canvases it creates with
`document.createElement("canvas")`, sized to the design size at the device
pixel ratio it chooses, and a
[`SurfaceMetrics`](/engines/structured-3d/apis/engine/) object supplying that
size, that ratio, and the event target the engine listens on. The first canvas
is the stage, which the engine obtains its `webgl2` context from, and the second
is the screen layer.

```ts
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type GameDefinition,
  type SurfaceMetrics,
} from "@clockwyrks/structured-3d";
import { FIELD_H, FIELD_W } from "../src/constants";
import { game } from "../src/game";
import type { Debug } from "./debug";

export interface Harness {
  engine: Engine<Debug>;
  stage: HTMLCanvasElement;
  screen: HTMLCanvasElement;
  keys: EventTarget;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

export function createHarness(
  clock: Clock = new ConstantClock(1000 / 60),
  dpr = 1,
  prepare: (screen: HTMLCanvasElement) => void = () => {},
): Harness {
  const stage = canvas(FIELD_W * dpr, FIELD_H * dpr);
  const screen = canvas(FIELD_W * dpr, FIELD_H * dpr);
  prepare(screen);
  const keys = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => dpr,
    events: () => keys,
  };

  const engine = createEngine<Debug>({
    canvas: stage,
    screen,
    width: FIELD_W,
    height: FIELD_H,
    game: game as GameDefinition<Debug>,
    clock,
    surface,
  });

  return { engine, stage, screen, keys };
}
```

`createEngine` takes the build's `GameDefinition` and returns an `Engine` whose
one type parameter is the debug surface, because the game's state lives in the
framework objects the engine owns and the surface is the one value the build
hands back. The harness differs from a browser build's construction in two
respects. The canvases are created by the harness and stay outside the document,
so the `surface` reports the size and ratio the harness chose, where a page's
canvas would be measured from its layout. The `screen` canvas is handed in
explicitly, so the harness keeps the handle and a check reads the layer's pixels
and its operations off it.

`prepare` runs on the screen canvas before the engine is created, which is
where a check that records the screen layer's operations installs its proxy;
the engine obtains the screen layer's context at construction. The surface
reports the logical design size at a device pixel ratio of `1` by default,
which puts one device pixel on one logical unit and makes a sampled coordinate
readable without arithmetic. The `dpr` parameter sizes both canvases, so a
harness built at `2` exercises the fit itself.

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
`engine.scene` is available from construction, and holds the pipeline's objects
once a frame has synced them.

Call `engine.destroy()` when a suite is finished with an engine, which closes
the world, halts the loop, drops the listeners it attached, and releases the
`webgl2` context.

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
import type { Vec3 } from "@clockwyrks/structured-3d";

export type Mode = "solo" | "versus";

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
  setBallPosition(x: number, y: number, z: number): void;
  setBallVelocity(vx: number, vy: number, vz: number): void;
  snapshot(): Snapshot;
}
```

A pose states a position or a velocity as three components, and a reading
returns a world point as a plain `Vec3`, because the world is in three
dimensions and the check asserts on all three.

## An unmet precondition

A suite whose checks all skipped reports an unmet precondition, and the point is
left undecided for a reviewer rather than failed. A suite poses its own world
through the case's debug surface, removing what its requirement is not about and
placing what it is, so the setup has nothing to search for and every check
reaches a verdict; see
[Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/).

## The module contract

A suite imports the build, so a case fixes three module paths and what each one
exports. That contract is stated in the case's specification and is what gives
every build of the case the same shape to check.

| Module | Supplied by | Holds |
| --- | --- | --- |
| `src/constants.ts` | The case | The design size, the palette, the level names, the actor tag vocabulary, the action names with the keys they bind, the cue names, the arena's dimensions in world units, and every tunable the specification fixes. |
| `src/game.ts` | The build | The `GameDefinition` the engine drives, whose instance's `initialize` returns the debug surface to the instrumentation spec. |
| `src/main.ts` | The case | The browser entry, which builds the engine over the page's canvas with a wall clock and runs it. |

The contract is small because the engine's own object model is what a check
reads. A suite finds actors with `world.byTag`, reads the match through
`world.state`, drives a pawn by possessing it with a controller of its own,
reads the pipeline's objects off `engine.scene`, and observes transitions on
`engine.events`, so none of that has to be exported by the build. The case fixes
the tag vocabulary and the level names so that a check names things every build
of the case agrees on.

A suite imports `constants.ts` for the numbers and names its assertions are
stated in and `game.ts` for the definition it drives. `main.ts` belongs to the
built page, and a suite constructs its own engine instead. The surface reaches a
suite only through `engine.debug`, typed by the suite's own declaration of the
spec, and each of its operations acts on the world the engine holds.

The build writes `game.ts` against the other two, and its instance's
`initialize` returns the surface. It is free in where it implements the surface
and how it organizes everything else under `src/`, because the contract covers
what a check imports rather than how a build is structured.
