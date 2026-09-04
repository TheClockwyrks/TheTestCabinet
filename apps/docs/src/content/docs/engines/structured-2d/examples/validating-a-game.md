---
title: Validating a Game
---

A case's validators are vitest suites that run in the same process as the build.
A suite imports the engine, the case's own constants, and the build's game
definition, creates an engine over a canvas it owns and a clock it scripts, and
steps the game with `engine.advance`. A check poses its scenario through the
build's debug surface, read off `engine.debug`, and everything else it reads is
an engine surface: the world and the actors in it, the match the game mode
holds, the events the engine broadcast, and the pixels or the draw calls the
pipeline produced.

## The case under test

The case is a collection arena. A runner pawn moves under a player controller,
sweeps up orbs by overlapping them, and the match travels to a summary level
once the last orb is gone.

| Figure | Value |
| --- | --- |
| Logical design size | `640 × 360` |
| Levels | `arena`, then `summary` |
| Tag vocabulary | `wall`, `orb`, `runner` |
| Runner | The pawn player 0 possesses, radius `12`, `180` units per second |
| Dash | `480` units per second for `0.25` seconds, armed by one press |
| Orbs | Six, radius `8`, worth `10` points each, destroyed on overlap |
| Actions | `up`, `down`, `left`, `right`, `dash` |
| Cues | `collect`, `dash`, `over` |
| Diagnostics | `best` on the instance, `orbs` on the world |

The case fixes the level names, the tag vocabulary, the action names with the
keys they bind, and the cue names, so a check names things every build of the
case agrees on. The arena's walls are the build's choice, which is why the check
that reads a wall collision is conditional.

## The figures

Every figure the specification fixes is stated twice: the build is seeded a
`src/constants.ts`, and the validator project transcribes the same figures into
its own `constants.ts`.

```ts
// src/constants.ts — the build's copy, seeded with the workspace
export const DESIGN_WIDTH = 640;
export const DESIGN_HEIGHT = 360;

export const BACKGROUND = "#0b0f18";
export const WALL_COLOR = "#2a3550";
export const ORB_COLOR = "#f7c948";
export const RUNNER_COLOR = "#7fd1ff";

export const LEVELS = {
  arena: "arena",
  summary: "summary",
} as const;

export const TAGS = {
  wall: "wall",
  orb: "orb",
  runner: "runner",
} as const;

export const ACTIONS = {
  up: { keys: ["KeyW", "ArrowUp"] },
  down: { keys: ["KeyS", "ArrowDown"] },
  left: { keys: ["KeyA", "ArrowLeft"] },
  right: { keys: ["KeyD", "ArrowRight"] },
  dash: { keys: ["Space"] },
} as const;

export const CUES = {
  collect: { freq: 880, freqTo: 1320, durationMs: 90 },
  dash: { wave: "square", freq: 220, freqTo: 110, durationMs: 120 },
  over: { freq: 440, freqTo: 220, durationMs: 400 },
} as const;

export type ActionName = keyof typeof ACTIONS;

export const ORB_COUNT = 6;
export const ORB_RADIUS = 8;
export const ORB_POINTS = 10;
export const ORB_LAYER = 0;

export const RUNNER_RADIUS = 12;
export const RUNNER_SPEED = 180;
export const RUNNER_LAYER = 1;

export const DASH_SPEED = 480;
export const DASH_SECONDS = 0.25;

export const MATCH_SECONDS = 30;
```

The two layer numbers are part of the specification because a check reads the
draw order off them. The pipeline sorts by `layer` ascending, so the orbs are
drawn before the runner and the runner's operations are the last in the stream.

The validator project states the figures its checks name, under the same names,
transcribed from the same specification.

```ts
// validation/constants.ts — transcribed from the specification
export const DESIGN_WIDTH = 640;
export const DESIGN_HEIGHT = 360;

export const BACKGROUND = "#0b0f18";
export const ORB_COLOR = "#f7c948";
export const RUNNER_COLOR = "#7fd1ff";

export const LEVELS = { arena: "arena", summary: "summary" } as const;
export const TAGS = { wall: "wall", orb: "orb", runner: "runner" } as const;

export const ACTIONS = {
  up: { keys: ["KeyW", "ArrowUp"] },
  down: { keys: ["KeyS", "ArrowDown"] },
  left: { keys: ["KeyA", "ArrowLeft"] },
  right: { keys: ["KeyD", "ArrowRight"] },
  dash: { keys: ["Space"] },
} as const;

export type ActionName = keyof typeof ACTIONS;

export const ORB_COUNT = 6;
export const ORB_POINTS = 10;

export const RUNNER_RADIUS = 12;
export const RUNNER_SPEED = 180;

export const DASH_SPEED = 480;
export const DASH_SECONDS = 0.25;
```

The transcription is what makes a check a grade. A check that imported
`RUNNER_SPEED` from `../src/constants` would compare the build with its own
table, which every build matches, including one that walks its runner at some
other speed. `constants.ts` is the only file in the project that reaches
`../src/constants`, and it reaches it only to re-export a value the
specification leaves to the build; see
[Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/).

## The debug surface

The case's instrumentation spec fixes the operations a build offers for posing
and reading the arena, and the suite declares its own type for them from that
spec. A pose takes only its own arguments and returns nothing, and a reading
takes nothing and returns plain data.

```ts
// validation/debug.ts
import type { Vec2 } from "@test-cabinet/structured-2d";

export interface Snapshot {
  level: string;
  phase: string;
  runner: { x: number; y: number };
  orbs: { x: number; y: number }[];
  score: number;
}

export interface Debug {
  placeRunner(at: Vec2): void;
  placeOrb(index: number, at: Vec2): void;
  keepOrbs(count: number): void;
  snapshot(): Snapshot;
}
```

Orbs are indexed in the order `world.byTag` lists them, which is spawn order.
`keepOrbs` destroys the surplus. A destroyed actor stops ticking and stops
rendering at once and leaves `byTag` at once, and it leaves the world at the end
of the frame, so a pose that destroys is followed by one `engine.advance(1)`
before a check counts what remains.

## The build under test

The build supplies the game definition, and the case's specification fixes the
module it comes from. The instance's `initialize` returns the debug surface, and
each operation acts on the world the engine holds at the moment of the call,
through the same systems play uses: a pose finds actors by tag, moves a
transform, or destroys an actor, and a reading reads the match off the game
state. The build declares the surface's type itself, from the same spec the
suite declares its own from.

```ts
// src/game.ts
import {
  GameInstance,
  type Actor,
  type ActorSpec,
  type GameDefinition,
  type InitApi,
  type Pawn,
  type Vec2,
} from "@test-cabinet/structured-2d";
import { Orb } from "./actors/orb";
import { Wall } from "./actors/wall";
import {
  ACTIONS,
  CUES,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  LEVELS,
  ORB_COUNT,
  TAGS,
} from "./constants";
import { ArenaMode } from "./modes/arena-mode";
import { SummaryMode } from "./modes/summary-mode";

const WALL_THICKNESS = 16;
const HALF = WALL_THICKNESS / 2;

export interface Snapshot {
  level: string;
  phase: string;
  runner: { x: number; y: number };
  orbs: { x: number; y: number }[];
  score: number;
}

export interface Debug {
  placeRunner(at: Vec2): void;
  placeOrb(index: number, at: Vec2): void;
  keepOrbs(count: number): void;
  snapshot(): Snapshot;
}

class Collector extends GameInstance<Debug> {
  best = 0;

  override initialize(api: InitApi): Debug {
    for (const [name, binding] of Object.entries(ACTIONS)) {
      api.input.register(name, { keys: [...binding.keys] });
    }
    for (const [cue, spec] of Object.entries(CUES)) {
      api.audio.define(cue, spec);
    }
    api.diagnostics.register("best", () => this.best);

    return {
      placeRunner: (at) => {
        const runner = this.runner();
        runner.transform.x = at.x;
        runner.transform.y = at.y;
      },
      placeOrb: (index, at) => {
        const orb = this.orbs()[index];
        if (orb === undefined) throw new Error(`the arena holds no orb ${index}`);
        orb.transform.x = at.x;
        orb.transform.y = at.y;
      },
      keepOrbs: (count) => {
        const orbs = this.orbs();
        if (orbs.length < count) throw new Error(`the arena holds ${orbs.length} orbs`);
        for (const orb of orbs.slice(count)) orb.destroy();
      },
      snapshot: () => {
        const world = this.engine.world;
        const runner = this.runner();
        return {
          level: world.level,
          phase: world.state.phase,
          runner: { x: runner.transform.x, y: runner.transform.y },
          orbs: this.orbs().map((orb) => ({ x: orb.transform.x, y: orb.transform.y })),
          score: world.state.players[0]?.score ?? 0,
        };
      },
    };
  }

  private runner(): Pawn {
    const [player] = this.engine.world.players();
    const pawn = player?.pawn ?? null;
    if (pawn === null) throw new Error("no player controller holds a runner");
    return pawn;
  }

  private orbs(): readonly Actor[] {
    return this.engine.world.byTag(TAGS.orb);
  }
}

function wall(x: number, y: number, width: number, height: number): ActorSpec<Wall> {
  return {
    type: Wall,
    transform: { x, y },
    tags: [TAGS.wall],
    configure: (actor) => actor.resize(width, height),
  };
}

const orbs: readonly ActorSpec<Orb>[] = Array.from({ length: ORB_COUNT }, (_, i) => {
  const angle = (i / ORB_COUNT) * Math.PI * 2;
  return {
    type: Orb,
    transform: {
      x: DESIGN_WIDTH / 2 + Math.cos(angle) * 120,
      y: DESIGN_HEIGHT / 2 + Math.sin(angle) * 90,
    },
    tags: [TAGS.orb],
  };
});

export const game: GameDefinition<Debug> = {
  instance: Collector,
  levels: {
    [LEVELS.arena]: {
      mode: ArenaMode,
      actors: [
        wall(DESIGN_WIDTH / 2, HALF, DESIGN_WIDTH, WALL_THICKNESS),
        wall(DESIGN_WIDTH / 2, DESIGN_HEIGHT - HALF, DESIGN_WIDTH, WALL_THICKNESS),
        wall(HALF, DESIGN_HEIGHT / 2, WALL_THICKNESS, DESIGN_HEIGHT),
        wall(DESIGN_WIDTH - HALF, DESIGN_HEIGHT / 2, WALL_THICKNESS, DESIGN_HEIGHT),
        ...orbs,
      ],
    },
    [LEVELS.summary]: { mode: SummaryMode },
  },
  startLevel: LEVELS.arena,
};
```

`ArenaMode` carries `pawnClass = Runner` and adds player 0 in its `beginPlay`,
which is what spawns the runner and possesses it, and registers `orbs` on the
world's registry there. The walls and the orbs are
declared actors, so they are built before the mode begins play and their ids are
lower than the runner's.

Every operation reads `this.engine.world` when it is called rather than holding
a world, so the surface follows a transition and the summary level answers a
`snapshot` as readily as the arena. The engine holds the returned object and
reads no member of it, and nothing on it runs until a caller drives it.

## Layout

The build owns `src/`, and the case's validators live beside it in
`validation/`. In the case's version folder they live in
`validation/structured-2d/`, and the seeded workspace receives them at
`validation/`.

```text
package.json
tsconfig.json
vitest.config.ts
src/
  constants.ts
  game.ts
  main.ts
  actors/
  modes/
validation/
  vitest.config.ts
  tsconfig.json
  constants.ts
  debug.ts
  harness.ts
  simulation.test.ts
  world-and-actors.test.ts
  rendering.test.ts
  input-and-audio.test.ts
```

One `.test.ts` stands for one verdict item, and `harness.ts` is shared by all of
them. The case's config roots itself at the workspace, so a validator resolves
`../src/game` by the same relative path the build uses.

```ts
// validation/vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    coverage: { enabled: false },
  },
});
```

```json
// validation/tsconfig.json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "moduleResolution": "bundler"
  },
  "include": ["."]
}
```

`passWithNoTests` is `false`, so a validation run that collected nothing is a
failure rather than a pass. The two suites run as two commands.

```sh
npx vitest run                                       # the build's own tests
npx vitest run --config validation/vitest.config.ts  # the case's validators
```

The canvas and the runner are devDependencies of the seeded workspace.

```json
{
  "devDependencies": {
    "@napi-rs/canvas": "^0.1",
    "vitest": "^3"
  }
}
```

## The harness

Every validator builds its engine through one helper. It creates a canvas with
`@napi-rs/canvas`, supplies a `SurfaceMetrics` so the engine takes every
measurement from the harness instead of from a document, wraps the 2D context in
a recording proxy, subscribes to `asset:failed` before any game code runs, and
then initializes. The engine is parameterized with the suite's own `Debug`
type, so `engine.debug` is typed by the spec rather than by the build.

```ts
// validation/harness.ts
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type SurfaceMetrics,
  type Vec2,
  type World,
} from "@test-cabinet/structured-2d";
import {
  ACTIONS,
  BACKGROUND,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  type ActionName,
} from "./constants";
import { game } from "../src/game";
import type { Debug } from "./debug";

export type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

export interface HarnessOptions {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
}

export interface Harness {
  readonly engine: Engine<Debug>;
  readonly instance: GameInstance<Debug>;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  readonly assetFailures: string[];
  world(): World;
  hold(action: ActionName): void;
  release(action: ActionName): void;
  tap(action: ActionName): void;
  device(point: Vec2): { x: number; y: number };
  pixel(point: Vec2): [number, number, number, number];
  dispose(): void;
}

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

export function rgba(color: string): [number, number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function toDevice(world: World, point: Vec2): { x: number; y: number } {
  const logical = world.camera.worldToLogical(point);
  const view = world.viewport();
  return {
    x: Math.round(view.offsetX + logical.x * view.scale),
    y: Math.round(view.offsetY + logical.y * view.scale),
  };
}

function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

export function callsTo(calls: readonly DrawCall[], method: string): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

export function setsOf(calls: readonly DrawCall[], property: string): unknown[] {
  return calls.flatMap((call) =>
    call.kind === "set" && call.property === property ? [call.value] : [],
  );
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const cssWidth = options.cssWidth ?? DESIGN_WIDTH;
  const cssHeight = options.cssHeight ?? DESIGN_HEIGHT;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(Math.round(cssWidth * dpr), Math.round(cssHeight * dpr));
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => recorded,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<Debug>({
    canvas: element,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    game: game as GameDefinition<Debug>,
    background: BACKGROUND,
    clock: options.clock ?? new ConstantClock(1000 / 60),
    surface,
  });

  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });

  const instance = await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", action: ActionName): void => {
    events.dispatchEvent(new KeyEvent(type, ACTIONS[action].keys[0]));
  };

  return {
    engine,
    instance,
    ctx,
    calls,
    assetFailures,
    world: () => engine.world,
    hold: (action) => dispatch("keydown", action),
    release: (action) => dispatch("keyup", action),
    tap: (action) => {
      dispatch("keydown", action);
      dispatch("keyup", action);
    },
    device: (point) => toDevice(engine.world, point),
    pixel: (point) => {
      const at = toDevice(engine.world, point);
      const { data } = ctx.getImageData(at.x, at.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    dispose: () => engine.destroy(),
  };
}
```

Six details carry the harness.

The options handed to `createEngine` are the ones the case fixes: the design
size and the background. Everything else the build decided is inside the game
definition, which is what makes one validator suite serve every build of the
case.

The cast to `GameDefinition<Debug>` states that the build's surface is the one
the spec names. The suite's `Debug` is declared in `validation/debug.ts` from
the instrumentation spec, and a build whose surface departs from it fails the
checks that drive it.

`SurfaceMetrics` supplies the element size, the device pixel ratio, and the
event target the engine attaches its key listeners to. Handing it a plain
`EventTarget` gives the validator the seam a player's keyboard uses, so `hold`
and `release` drive actions through the bindings the game registered and reach
the simulation through the player controller.

`world()` reads `engine.world` on every call. A transition rebuilds the world,
so a check that travels holds the engine and asks for the world again rather
than holding a world across the transition. `engine.debug` is the object the
build's `initialize` returned, and a check drives it directly:
`engine.debug.placeRunner(at)` poses, and `engine.debug.snapshot()` reads.

`toDevice` converts through the camera and then the viewport. `worldToLogical`
applies the camera's position, zoom, and rotation, and the viewport applies the
scale and the letterbox offsets, so a check names a world point and reads the
device pixel the engine drew it into.

Subscribing before `engine.initialize()` is what makes an asset failure visible.
Construction runs no game code, so the handler is attached in time to observe
the instance's own initialization and the start level's `load`.

## Stepping the simulation

A [`ConstantClock`](/engines/structured-2d/apis/clocks/) makes each frame
worth a known step, so a duration is a frame count and the arithmetic a check
asserts is the arithmetic the specification states. The validator poses the
scenario through the debug surface, advances, and reads a snapshot back.

```ts
// validation/simulation.test.ts
import { ConstantClock, type Vec2 } from "@test-cabinet/structured-2d";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  DASH_SECONDS,
  DASH_SPEED,
  DESIGN_WIDTH,
  RUNNER_RADIUS,
  RUNNER_SPEED,
  TAGS,
} from "./constants";
import { createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("carries the runner at its stated speed", async () => {
  const { engine } = harness;
  engine.debug.placeRunner({ x: 320, y: 180 });

  harness.hold("right");
  await engine.advance(60);

  const { runner } = engine.debug.snapshot();
  expect(engine.frame().count).toBe(60);
  expect(engine.frame().timeMs).toBeCloseTo(1000, 6);
  expect(runner.x).toBeCloseTo(320 + RUNNER_SPEED, 2);
  expect(runner.y).toBeCloseTo(180, 6);
  expect(harness.assetFailures).toEqual([]);
});

it("spends the dash over its stated duration", async () => {
  const { engine } = harness;
  engine.debug.placeRunner({ x: 320, y: 180 });

  harness.hold("right");
  harness.tap("dash");
  await engine.advance(60);

  const dashed = DASH_SPEED * DASH_SECONDS;
  const walked = RUNNER_SPEED * (1 - DASH_SECONDS);
  expect(engine.debug.snapshot().runner.x).toBeCloseTo(320 + dashed + walked, 2);
});

it("is blocked by the arena wall", async () => {
  const { engine } = harness;
  engine.debug.placeRunner({ x: 320, y: 180 });

  const hits: { wall: boolean; normal: Vec2 }[] = [];
  engine.events.on("hit", ({ a, manifold }) => {
    hits.push({
      wall: a.hasTag(TAGS.wall),
      normal: { x: manifold.normal.x, y: manifold.normal.y },
    });
  });

  harness.hold("right");
  await engine.advance(120);

  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].wall).toBe(true);
  expect(hits[0].normal.x).toBeCloseTo(-1, 6);
  expect(engine.debug.snapshot().runner.x).toBeLessThan(DESIGN_WIDTH - RUNNER_RADIUS);
});
```

Sixty frames of `1000 / 60` milliseconds are one second exactly, so the runner
covers 180 units and the frame counter reads 60. Each snapshot is taken after
the advance, so it reads the world the frame left rather than the one the pose
built. The dash costs a quarter of
that second at 480 units per second and the remaining three quarters run at the
walking speed, which is 120 units plus 135.

The third check reads a collision at the arena wall, which the case's
specification declares, so the check runs against every build and a build with
an open field fails it.

A `hit` names the actor with the lower `id` as `a`. The walls are declared
actors and the runner is spawned by the game mode, so the wall is always `a` and
the manifold's normal points from the wall toward the runner.

## Asserting on the world and the actors

The engine's own object model is what a check reads. A suite finds actors by
tag, reads the match off the game state, and observes a transition on
`engine.events`, and the debug surface poses the situation each check reads.

```ts
// validation/world-and-actors.test.ts
import { afterEach, beforeEach, expect, it } from "vitest";
import { LEVELS, ORB_COUNT, ORB_POINTS, TAGS } from "./constants";
import { createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("opens the arena with its orbs and one possessed runner", () => {
  const { engine } = harness;
  const world = harness.world();

  expect(world.level).toBe(LEVELS.arena);
  expect(world.mode.phase).toBe("playing");
  expect(world.state.phase).toBe("playing");
  expect(world.byTag(TAGS.orb)).toHaveLength(ORB_COUNT);

  const [player] = world.players();
  expect(player.index).toBe(0);
  expect(player.pawn?.hasTag(TAGS.runner)).toBe(true);
  expect(world.state.players).toHaveLength(1);

  const snapshot = engine.debug.snapshot();
  expect(snapshot.level).toBe(LEVELS.arena);
  expect(snapshot.orbs).toHaveLength(ORB_COUNT);
  expect(snapshot.runner).toEqual({
    x: player.pawn?.transform.x,
    y: player.pawn?.transform.y,
  });

  const ids = world.actors().map((actor) => actor.id);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
});

it("removes a destroyed orb from the world at the end of the frame", async () => {
  const { engine } = harness;
  const world = harness.world();

  const destroyed: number[] = [];
  engine.events.on("actor:destroyed", ({ actor }) => destroyed.push(actor.id));

  const [kept] = world.byTag(TAGS.orb);
  engine.debug.keepOrbs(1);
  expect(world.byTag(TAGS.orb)).toEqual([kept]);

  await engine.advance(1);

  expect(destroyed).toHaveLength(ORB_COUNT - 1);
  expect(world.actors().filter((actor) => actor.hasTag(TAGS.orb))).toEqual([kept]);
});

it("travels to the summary level when the last orb is collected", async () => {
  const { engine } = harness;
  const arena = harness.world();

  const travel: string[] = [];
  engine.events.on("world:opening", ({ from, to }) => travel.push(`${from} -> ${to}`));
  engine.events.on("world:opened", ({ level }) => travel.push(`opened ${level}`));

  engine.debug.keepOrbs(1);
  await engine.advance(1);
  engine.debug.placeOrb(0, { x: 320, y: 180 });
  engine.debug.placeRunner({ x: 320, y: 180 });
  await engine.advance(1);

  const summary = harness.world();
  expect(travel).toEqual([
    `${LEVELS.arena} -> ${LEVELS.summary}`,
    `opened ${LEVELS.summary}`,
  ]);
  expect(summary.level).toBe(LEVELS.summary);
  expect(summary).not.toBe(arena);
  expect(summary.mode.options.score).toBe(ORB_POINTS);
  expect(summary.time).toBeCloseTo(0, 6);
  expect(engine.debug.snapshot().level).toBe(LEVELS.summary);
  expect(engine.instance).toBe(harness.instance);
  expect(engine.frame().count).toBe(2);
});
```

The first check runs without advancing at all. `engine.initialize` resolves once
the start level's actors have begun play and its game mode has begun play, so
the arena is fully posed before the first frame.

`world.actors()` is in spawn order and ids are assigned in spawn order from `1`,
so the sorted comparison states that the two orders agree.

The transition check reads what survives it. The frame counter carries across,
`world.time` restarts at zero, and the game instance is the same object, which
is the one framework object that outlives a level. The options the mode was
opened with are what `world.open` was given, so the summary reads the score the
arena finished on. The debug surface survives too, and `snapshot` reports the
summary level because each operation reads the world off the engine when it is
called.

One frame is advanced after the orb is placed. The collision pass finds the
overlap, the mode ticks after it and requests the transition, and the engine
performs the request at the end of that same frame, before the next one begins.
No frame has stepped the summary world by the time the check reads it.

## Asserting the diagnostics a build registered

Registering the values the case names is the build's part. Drawing the panel,
toggling it, and keeping it read-only are the engine's, so a check reads
`engine.diagnostics()` and asserts the names the build registered and what each
one reports for a posed world.

```ts
// validation/diagnostics.test.ts
import { ConstantClock } from "@test-cabinet/structured-2d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("registers the diagnostics the case names", () => {
  const { engine } = harness;
  engine.debug.keepOrbs(2);

  expect(engine.diagnostics()).toEqual([
    { name: "best", value: 0 },
    { name: "orbs", value: 2 },
  ]);
});
```

The instance's sources come first and the world's follow, each in registration
order, so one comparison covers the names, their order, and what each source
reports. Reading evaluates the sources and changes nothing else, so a check
reads them at any point in a scenario, and the overlay stays hidden throughout.

A source the arena registers is dropped when the arena closes, so the same read
after the travel to `summary` returns the instance's sources and whatever the
summary level registered.

## Asserting on pixels and on the draw stream

Two readings of one frame answer two different questions. The pixels say what
ended up on the canvas, and the draw-call stream says what the pipeline asked
for.

The canvas is 800 by 360 CSS pixels at a device pixel ratio of 2, so the fit
scales the 640 by 360 field by 2 and centers it in a 1600 by 720 backing
store
with a 160 device pixel bar on each side. `getImageData` reads device pixels and
ignores the context transform, so the harness maps the world point itself.

Sample at least two world units inside a shape. A circle's rim is
anti-aliased, so a pixel on the edge of an orb is a blend of the orb color and
whatever is behind it, while a pixel two units in is the fill exactly.

```ts
// validation/rendering.test.ts
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BACKGROUND,
  ORB_COLOR,
  ORB_COUNT,
  RUNNER_COLOR,
  RUNNER_RADIUS,
} from "./constants";
import { callsTo, createHarness, rgba, setsOf, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
});

afterEach(() => {
  harness.dispose();
});

it("draws the runner and an orb in the colors the case fixes", async () => {
  const { engine } = harness;
  engine.debug.keepOrbs(1);
  engine.debug.placeOrb(0, { x: 480, y: 180 });
  engine.debug.placeRunner({ x: 320, y: 180 });

  await engine.advance(1);

  expect(harness.device({ x: 0, y: 0 })).toEqual({ x: 160, y: 0 });
  expect(harness.pixel({ x: 320, y: 180 })).toEqual(rgba(RUNNER_COLOR));
  expect(harness.pixel({ x: 480, y: 180 })).toEqual(rgba(ORB_COLOR));
  expect(harness.pixel({ x: 240, y: 100 })).toEqual(rgba(BACKGROUND));
});

it("draws the orbs beneath the runner", async () => {
  const { engine, calls } = harness;
  engine.debug.placeRunner({ x: 320, y: 180 });

  calls.length = 0;
  await engine.advance(1);

  const arcs = callsTo(calls, "arc");
  expect(arcs).toHaveLength(ORB_COUNT + 1);
  expect(arcs.at(-1)?.slice(0, 3)).toEqual([320, 180, RUNNER_RADIUS]);

  const fills = setsOf(calls, "fillStyle").filter((color) => color !== BACKGROUND);
  expect(fills.at(-1)).toBe(RUNNER_COLOR);
  expect(fills.filter((color) => color === ORB_COLOR)).toHaveLength(ORB_COUNT);
});

it("draws outlines alone in wireframe", async () => {
  const { engine, calls } = harness;
  engine.renderer.setMode("wireframe");

  calls.length = 0;
  await engine.advance(1);

  expect(engine.renderer.mode()).toBe("wireframe");
  expect(callsTo(calls, "fill")).toHaveLength(0);
  expect(callsTo(calls, "stroke").length).toBeGreaterThan(0);
});
```

The arc arguments are world coordinates. The engine draws each component with
the context already carrying the world-to-device transform, so what the stream
records is what the game asked for rather than where it landed.

The order of the stream is the pipeline's sort: `layer` ascending, then the
owning actor's spawn order within a layer, then attachment order within an
actor. The orbs sit on layer 0 and the runner on layer 1, so the runner's arc
and its fill color are the last of each. The sort is stable, so a redraw with no
change reproduces the order exactly.

Clearing `calls` immediately before the frame keeps the stream to that one
frame. The stream also carries the engine's own clear and transform, so a check
names the operations the pipeline made for the game and filters the background
color out of the fills it compares.

Both readings come from the same frame, because the recording proxy forwards
every call to the real context. One advance therefore produces a pixel buffer to
sample and a call list to inspect.

## Asserting on actions and cues

Dispatching a key event at the surface's event target sets the action the game
bound that key to, and the player controller reads it on the next frame.
`engine.events.on` returns the function that removes the handler, so a check
subscribes, runs the scenario, and asserts against what the handler collected.

```ts
// validation/input-and-audio.test.ts
import { afterEach, beforeEach, expect, it } from "vitest";
import { ORB_POINTS, TAGS } from "./constants";
import { createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("plays the dash cue once per press", async () => {
  const { engine } = harness;
  engine.debug.placeRunner({ x: 320, y: 180 });

  const played: { cue: string; t: number; gain: number }[] = [];
  const off = engine.events.on("cue:played", (event) => played.push(event));

  harness.hold("dash");
  await engine.advance(30);
  harness.release("dash");
  await engine.advance(30);
  off();

  expect(played.map((event) => event.cue)).toEqual(["dash"]);
  expect(played[0].gain).toBeGreaterThan(0);
  expect(played[0].t).toBeGreaterThan(0);
});

it("plays the collect cue and scores the orb it removed", async () => {
  const { engine } = harness;
  const world = harness.world();
  engine.debug.keepOrbs(2);
  await engine.advance(1);
  engine.debug.placeOrb(0, { x: 200, y: 180 });
  engine.debug.placeRunner({ x: 200, y: 180 });

  const collected: number[] = [];
  const off = engine.events.on("cue:played", ({ cue, gain }) => {
    if (cue === "collect") collected.push(gain);
  });

  await engine.advance(1);
  off();

  expect(collected).toHaveLength(1);
  expect(engine.debug.snapshot().score).toBe(ORB_POINTS);
  expect(world.byTag(TAGS.orb)).toHaveLength(1);
});

it("emits a muted cue with no gain", async () => {
  const { engine } = harness;
  const world = harness.world();
  world.audio.setMuted(true);

  const gains: number[] = [];
  const off = engine.events.on("cue:played", ({ gain }) => gains.push(gain));

  harness.tap("dash");
  await engine.advance(2);
  off();

  expect(world.audio.muted()).toBe(true);
  expect(gains).toEqual([0]);
});
```

The first check holds the key for thirty frames and reads one cue. A press arms
one edge, `pressed` is true exactly once per armed edge per player controller,
and the engine closes the input frame after the frame renders, so the dash is
spent once however long the key is held.

`harness.tap` presses and releases between frames, which arms the edge for the
next frame. That is what a check of an edge-triggered action uses.

`t` is the frame loop's simulated time, so the timestamp a check reads is the
time the clock delivered rather than the real time the suite took to run.

A muted bus still emits `cue:played`, reporting `gain: 0`. The mute state is
therefore checkable without an audio device, and a check of the mute action
reads the events rather than the sound.
