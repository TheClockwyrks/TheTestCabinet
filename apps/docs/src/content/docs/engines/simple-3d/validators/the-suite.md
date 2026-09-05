---
title: The Suite
---

A suite is a `.test.ts` file that imports the build, constructs an engine, and
makes its assertions. Everything it needs is reachable through ordinary module
resolution, so a check is written the way any other TypeScript test is written.

## Where the files live

A case keeps its Simple 3D validators in one directory of its version folder,
`validation/simple-3d/`, holding one `.test.ts` file per verdict item and a
shared harness module. The file path mirrors the item's id, so
`validation/simple-3d/gameplay/delivery.test.ts` is the check behind the
`gameplay/delivery` item, and the item declares it as
`gameplay/delivery.test.ts`, relative to this directory.

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
    gameplay/delivery.test.ts
```

## The vitest project

The case's suites are a vitest project of their own, declared by a config the
case ships beside them rather than by the build's `vitest.config.ts`. The
build's config names `src/**/*.test.ts` and measures coverage over `src/`; the
case's names `validation/**/*.test.ts` and measures none.

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

The config belongs to the case, so the verdict is decided by the case's suites
whatever the build's own config declares, and the build's coverage counts the
build's tests alone.

The project runs in browser mode with the Playwright provider on headless
Chromium, so the suites run in a page and the engine renders there as it does
in the built game. Chromium renders WebGL2 in software with no GPU. The
Playwright Chromium is the one the runner's browser driver uses, and a host
without it fails the validation stage.

The root is the workspace rather than this directory, so a validator resolves
the build's modules by the same relative paths the build itself uses.
`emitReplay` is a browser command: the suite calls it from the page and it
runs on the Node side, where the file system is, which is how a
[recording](/engines/simple-3d/validators/recording/) reaches the run's media
directory.

## The harness

The harness builds an engine over two canvases it makes in the page with
`document.createElement("canvas")`, one as the stage and one as the screen
layer, each sized to the design size times the device pixel ratio the check
chose, and a [`SurfaceMetrics`](/engines/simple-3d/apis/engine/) object
supplying the size, the device pixel ratio, and the event target the engine
listens on.

```ts
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type Game,
  type SurfaceMetrics,
} from "@clockwyrks/simple-3d";
import { RAIL_Y, STAGE_H, STAGE_W } from "../src/constants";
import { game, type State } from "../src/game";
import type { Debug, Mode, Screen, Snapshot } from "./debug";

export interface Harness {
  readonly engine: Engine<State, Debug>;
  readonly stage: HTMLCanvasElement;
  readonly screen: HTMLCanvasElement;
  readonly keys: EventTarget;
  setScreen(screen: Screen): void;
  setMode(mode: Mode): void;
  setHookPosition(x: number, y: number, z: number): void;
  setHookVelocity(vx: number, vy: number, vz: number): void;
  setHeldCrate(id: number | null): void;
  snapshot(): Snapshot;
}

export function pageCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createHarness(
  clock: Clock = new ConstantClock(1000 / 60),
  dpr = 1,
  screen: HTMLCanvasElement = pageCanvas(STAGE_W * dpr, STAGE_H * dpr),
): Harness {
  const stage = pageCanvas(STAGE_W * dpr, STAGE_H * dpr);
  const keys = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => dpr,
    events: () => keys,
  };

  const engine = createEngine<State, Debug>({
    canvas: stage,
    screen,
    width: STAGE_W,
    height: STAGE_H,
    game: game as Game<State, Debug>,
    clock,
    surface,
  });

  return {
    engine,
    stage,
    screen,
    keys,
    setScreen: (screen) =>
      engine.apply((s) => engine.debug.setScreen(s, screen)),
    setMode: (mode) => engine.apply((s) => engine.debug.setMode(s, mode)),
    setHookPosition: (x, y, z) =>
      engine.apply((s) => engine.debug.setHookPosition(s, x, y, z)),
    setHookVelocity: (vx, vy, vz) =>
      engine.apply((s) => engine.debug.setHookVelocity(s, vx, vy, vz)),
    setHeldCrate: (id) =>
      engine.apply((s) => engine.debug.setHeldCrate(s, id)),
    snapshot: () => engine.debug.snapshot(engine.state),
  };
}

export function startShift(h: Harness, mode: Mode): void {
  h.setMode(mode);
  h.setScreen("playing");
  h.setHookPosition(0, RAIL_Y, 0);
  h.setHookVelocity(0, 0, 0);
  h.setHeldCrate(null);
}
```

Three lines separate this construction from the built page's. The canvases
stay detached from the document, so the engine obtains its `webgl2` context
from the stage canvas and renders the scene into it exactly as it does in a
browser tab, with nothing laid out around it. `screen` hands the engine the
second canvas for the screen layer, so the engine draws HUD text and readouts
through its 2D context and the harness keeps both handles so a check reads
either layer's pixels back. `surface` supplies the size, the ratio, and the
event target, because a detached canvas has no laid-out size of its own.

The scene is maintained and its world matrices updated every frame, so
`engine.scene` holds what the build placed and `engine.view()` answers from
the camera the build posed. The surface reports the logical design size at a
device pixel ratio of `1` by default, which puts one device pixel of either
canvas on one logical unit and makes a sampled coordinate readable without
arithmetic. Building the harness at a ratio of `2` sizes both canvases to
twice the design size and is how a check exercises the mapping itself.

The members after `keys` wrap the debug surface over the engine. A pose on the
surface takes the current state and returns the next, so the harness hands it
to `engine.apply`; a reading takes the state, so the harness hands it
`engine.state`. A check then names the operation and nothing else.

Every operation the surface carries sets one element of the world, so the
sequences a scenario is opened with belong to the harness. `startShift` is one
of them: it is written once, from the atomic operations, and every check that
needs a shift under way calls it, while a check that needs only part of the
arrangement calls the operations it needs.

## Initialization order

`createEngine` is synchronous and runs no game code, so a suite subscribes to
[`engine.events`](/engines/simple-3d/apis/game/) before the game's own
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
listeners it attached and releases the canvases.

## The debug surface

A check poses its scenario through the surface the game returned beside its
state, read off `engine.debug` of the engine the suite constructed. The surface
holds no state: a pose is a transition the check drives through `engine.apply`,
and a reading is a function of `engine.state`.

```ts
const h = createHarness();
await h.engine.initialize();

startShift(h, "practice");
h.setHookVelocity(2, 0, 0);
await h.engine.advance(30);

expect(h.snapshot().hook.x).toBeCloseTo(1, 3);
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

export type Mode = "practice" | "timed";
export type Screen = "title" | "countdown" | "playing" | "over";

export interface Snapshot {
  screen: Screen;
  mode: Mode;
  score: number;
  hook: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  held: number | null;
  crates: { id: number; x: number; y: number; z: number }[];
}

export interface Debug {
  version: number;
  setScreen(state: DeepReadonly<State>, screen: Screen): State;
  setMode(state: DeepReadonly<State>, mode: Mode): State;
  setHookPosition(state: DeepReadonly<State>, x: number, y: number, z: number): State;
  setHookVelocity(state: DeepReadonly<State>, vx: number, vy: number, vz: number): State;
  setHeldCrate(state: DeepReadonly<State>, id: number | null): State;
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

| Module | Supplied by | Holds |
| --- | --- | --- |
| `src/constants.ts` | The case | The logical design size, the world's extents, the palette, the names the build gives its scene objects, the action names with the keys they bind, the cue names, and every tunable the specification fixes. |
| `src/game.ts` | The build | The `State` type the case declares and the `Game` the engine drives, whose `initialize` returns `[state, surface]` to the instrumentation spec. |
| `src/main.ts` | The case | The browser entry, which builds the engine over the page's canvas with a wall clock and runs it. |

A suite imports `constants.ts` for the numbers and names its assertions are
stated in and `game.ts` for the game it drives. `main.ts` belongs to the built
page, and a suite constructs its own engine instead. The surface reaches a suite
only through `engine.debug`, typed by the suite's own declaration of the spec,
and is driven through `engine.apply` and `engine.state`.

The names the build gives its scene objects are part of the contract because a
check finds an object in `engine.scene` by name, and a name is a string the
case fixes the way it fixes a cue name. `three` is a peer dependency of the
engine that the build declares itself, so a suite that walks the scene imports
`three` from the same workspace and sees the same classes the build
constructed.

The build writes `game.ts` against the other two, and its `initialize` returns
the surface beside the state. It is free in where it implements the surface and
how it organizes everything else under `src/`, because the contract covers what
a check imports rather than how a build is structured.
