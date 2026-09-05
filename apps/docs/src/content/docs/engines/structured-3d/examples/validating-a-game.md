---
title: Validating a Game
---

A case's validators are vitest suites that run in a browser. The project runs
in vitest browser mode with the Playwright provider on headless Chromium, and a
suite runs in the page: it imports the engine, the case's own constants, and
the build's game definition, creates an engine over canvases it makes with
`document.createElement("canvas")` and a clock it scripts, and steps the game
with `engine.advance`. A check poses its scenario through the build's debug
surface, read off `engine.debug`, and everything else it reads is an engine
surface: the world and the actors in it, the match the game mode holds, the
events the engine broadcast, the scene the pipeline placed, the camera's
projection, the pixels of the stage canvas, the pixels and the draw calls of
the screen layer, and the recording of the frames the engine drew.

Chromium renders WebGL2 in software, so the world pass produces its pixels with
no GPU on the host. A claim about what the world pass drew is checked against
the scene, the projection, and the stage canvas's pixels, and the recording
hands the reviewer the same frames afterwards.

## The case under test

The case is a collection arena. A runner pawn moves on the ground plane under a
player controller, sweeps up orbs by overlapping them, and the match travels to
a summary level once the last orb is gone.

| Figure | Value |
| --- | --- |
| Logical design size | `640 × 360` |
| Arena | `16 × 9` world units on the `y = 0` plane, centered on the origin, walled on four sides |
| Camera | Perspective, at `(0, 12, 9)`, looking at the origin |
| Levels | `arena`, then `summary` |
| Tag vocabulary | `wall`, `orb`, `runner` |
| Runner | The pawn player 0 possesses, a sphere of radius `0.5` centered on its transform, `4` units per second |
| Dash | `12` units per second for `0.25` seconds, armed by one press |
| Orbs | Six, radius `0.3`, worth `10` points each, destroyed on overlap |
| HUD | A `140 × 28` panel centered at `(80, 24)` on the screen layer, and a `score N` readout over it |
| Actions | `up`, `down`, `left`, `right`, `dash` |
| Cues | `collect`, played at the collected orb's position; `dash`; `over` |
| Diagnostics | `best` on the instance, `orbs` on the world |

The case fixes the level names, the tag vocabulary, the action names with the
keys they bind, the cue names, the camera's pose, and the HUD's place, so a
check names things every build of the case agrees on. The arena's wall
thickness is the build's choice, which is why the check that reads a wall
collision asserts the side the runner stopped on rather than where.

## The case's constants

Every figure the specification fixes lives in one module the build imports and
the validators import.

```ts
// src/constants.ts
import { vec3 } from "@clockwyrks/structured-3d";

export const DESIGN_WIDTH = 640;
export const DESIGN_HEIGHT = 360;

export const BACKGROUND = "#0b0f18";
export const WALL_COLOR = "#2a3550";
export const ORB_COLOR = "#f7c948";
export const RUNNER_COLOR = "#7fd1ff";
export const HUD_COLOR = "#1a2238";
export const SCORE_COLOR = "#f2f5f7";

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

export const ARENA_WIDTH = 16;
export const ARENA_DEPTH = 9;

export const CAMERA = { position: vec3(0, 12, 9), target: vec3(0, 0, 0) };

export const ORB_COUNT = 6;
export const ORB_RADIUS = 0.3;
export const ORB_POINTS = 10;

export const RUNNER_RADIUS = 0.5;
export const RUNNER_SPEED = 4;

export const DASH_SPEED = 12;
export const DASH_SECONDS = 0.25;

export const HUD = { x: 80, y: 24, width: 140, height: 28 };
export const HUD_LAYER = 0;
export const SCORE_LAYER = 1;

export const MATCH_SECONDS = 30;
```

`up` and `down` move the runner along `-Z` and `+Z`, and `left` and `right`
along `-X` and `+X`, so from the case's camera `up` is up the screen. The two
HUD layer numbers are part of the specification because a check reads the
screen layer's draw order off them. The screen pass sorts by `layer`
ascending, so the panel is drawn before the readout and the readout's
operations are the last in the stream.

## The debug surface

The case's instrumentation spec fixes the operations a build offers for posing
and reading the arena, and the suite declares its own type for them from that
spec. A pose takes only its own arguments and returns nothing, and a reading
takes nothing and returns plain data.

```ts
// validation/debug.ts
import type { Vec3 } from "@clockwyrks/structured-3d";

export interface Snapshot {
  level: string;
  phase: string;
  runner: Vec3;
  orbs: Vec3[];
  score: number;
}

export interface Debug {
  placeRunner(at: Vec3): void;
  placeOrb(index: number, at: Vec3): void;
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
through the same systems play uses: a pose finds actors by tag, assigns a
transform's position, or destroys an actor, and a reading reads the match off
the game state. The build declares the surface's type itself, from the same spec
the suite declares its own from.

```ts
// src/game.ts
import {
  GameInstance,
  vec3,
  type Actor,
  type ActorSpec,
  type GameDefinition,
  type InitApi,
  type Pawn,
  type Vec3,
} from "@clockwyrks/structured-3d";
import { Hud } from "./actors/hud";
import { Lights } from "./actors/lights";
import { Orb } from "./actors/orb";
import { Wall } from "./actors/wall";
import {
  ACTIONS,
  ARENA_DEPTH,
  ARENA_WIDTH,
  CUES,
  HUD,
  LEVELS,
  ORB_COUNT,
  TAGS,
} from "./constants";
import { ArenaMode } from "./modes/arena-mode";
import { SummaryMode } from "./modes/summary-mode";

const WALL_THICKNESS = 0.5;
const WALL_HEIGHT = 1;
const HALF = WALL_THICKNESS / 2;

export interface Snapshot {
  level: string;
  phase: string;
  runner: Vec3;
  orbs: Vec3[];
  score: number;
}

export interface Debug {
  placeRunner(at: Vec3): void;
  placeOrb(index: number, at: Vec3): void;
  keepOrbs(count: number): void;
  snapshot(): Snapshot;
}

const copy = (at: Vec3): Vec3 => vec3(at.x, at.y, at.z);

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
        this.runner().transform.position = copy(at);
      },
      placeOrb: (index, at) => {
        const orb = this.orbs()[index];
        if (orb === undefined) throw new Error(`the arena holds no orb ${index}`);
        orb.transform.position = copy(at);
      },
      keepOrbs: (count) => {
        const orbs = this.orbs();
        if (orbs.length < count) throw new Error(`the arena holds ${orbs.length} orbs`);
        for (const orb of orbs.slice(count)) orb.destroy();
      },
      snapshot: () => {
        const world = this.engine.world;
        return {
          level: world.level,
          phase: world.state.phase,
          runner: copy(this.runner().transform.position),
          orbs: this.orbs().map((orb) => copy(orb.transform.position)),
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

function wall(x: number, z: number, width: number, depth: number): ActorSpec<Wall> {
  return {
    type: Wall,
    transform: { position: vec3(x, WALL_HEIGHT / 2, z) },
    tags: [TAGS.wall],
    configure: (actor) => actor.resize(width, WALL_HEIGHT, depth),
  };
}

const orbs: readonly ActorSpec<Orb>[] = Array.from({ length: ORB_COUNT }, (_, i) => {
  const angle = (i / ORB_COUNT) * Math.PI * 2;
  return {
    type: Orb,
    transform: { position: vec3(Math.cos(angle) * 5, 0, Math.sin(angle) * 3) },
    tags: [TAGS.orb],
  };
});

export const game: GameDefinition<Debug> = {
  instance: Collector,
  levels: {
    [LEVELS.arena]: {
      mode: ArenaMode,
      actors: [
        { type: Lights },
        { type: Hud, transform: { position: vec3(HUD.x, HUD.y, 0) } },
        wall(0, -(ARENA_DEPTH / 2 + HALF), ARENA_WIDTH + 2 * WALL_THICKNESS, WALL_THICKNESS),
        wall(0, ARENA_DEPTH / 2 + HALF, ARENA_WIDTH + 2 * WALL_THICKNESS, WALL_THICKNESS),
        wall(-(ARENA_WIDTH / 2 + HALF), 0, WALL_THICKNESS, ARENA_DEPTH),
        wall(ARENA_WIDTH / 2 + HALF, 0, WALL_THICKNESS, ARENA_DEPTH),
        ...orbs,
      ],
    },
    [LEVELS.summary]: { mode: SummaryMode },
  },
  startLevel: LEVELS.arena,
};
```

`ArenaMode` carries `pawnClass = Runner` and adds player 0 in its `beginPlay`,
which is what spawns the runner and possesses it; it poses the world's camera
there, `camera.position = CAMERA.position` and `camera.lookAt(CAMERA.target)`,
and registers `orbs` on the world's registry. `Lights` carries a hemisphere and
a directional `LightComponent`, and `Hud` carries a `ShapeComponent` rect on
`HUD_LAYER` and a `TextComponent` on `SCORE_LAYER` whose `text` it rewrites from
`world.state` each tick; both are screen-space components, so the actor's
position is logical units. The walls and the orbs are declared actors, so they
are built before the mode begins play and their ids are lower than the runner's.

Every operation reads `this.engine.world` when it is called rather than holding
a world, so the surface follows a transition and the summary level answers a
`snapshot` as readily as the arena. A pose assigns a fresh `Vec3` to
`transform.position`, and a reading copies the position out, so the suite and
the build share no record. The engine holds the returned object and reads no
member of it, and nothing on it runs until a caller drives it.

## Layout

The build owns `src/`, and the case's validators live beside it in
`validation/`. In the case's version folder they live in
`validation/structured-3d/`, and the seeded workspace receives them at
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
  debug.ts
  harness.ts
  replay.ts
  simulation.test.ts
  world-and-actors.test.ts
  diagnostics.test.ts
  rendering.test.ts
  input-and-audio.test.ts
  recording.test.ts
```

One `.test.ts` stands for one verdict item, and `harness.ts` is shared by all of
them. The case's config roots itself at the workspace, so a validator resolves
`../src/constants` by the same relative path the build uses, and it runs the
project in browser mode on the Playwright Chromium.

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
failure rather than a pass. `emitReplay` is the browser command a suite writes
its recording through; it runs on the Node side with the suite's path in hand.
The two suites run as two commands.

```sh
npx vitest run                                       # the build's own tests
npx vitest run --config validation/vitest.config.ts  # the case's validators
```

The runner, its browser package, and Playwright are devDependencies of the
seeded workspace, and the Chromium Playwright launches is the one the runner's
browser driver uses. `three` is a dependency the build declares, and the suite
imports it for the scene checks, so the engine, the build, and the suite share
one instance.

```json
{
  "dependencies": {
    "three": "~0.182.0"
  },
  "devDependencies": {
    "@types/three": "~0.182.0",
    "@vitest/browser": "^3",
    "playwright": "^1",
    "vitest": "^3"
  }
}
```

## The harness

Every validator builds its engine through one helper. It creates two canvases
with `document.createElement("canvas")`, one as the stage and one as the screen
layer, supplies a `SurfaceMetrics` so the engine takes every measurement from
the harness rather than from a layout the canvases have none of, wraps the
screen canvas's 2D context in a recording proxy, subscribes to `asset:failed`
before any game code runs, and then initializes. The engine is parameterized
with the suite's own `Debug` type, so `engine.debug` is typed by the spec rather
than by the build.

```ts
// validation/harness.ts
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type SurfaceMetrics,
  type Vec2,
  type Vec3,
  type World,
} from "@clockwyrks/structured-3d";
import {
  ACTIONS,
  BACKGROUND,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  type ActionName,
} from "../src/constants";
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
  readonly stage: HTMLCanvasElement;
  readonly screen: CanvasRenderingContext2D;
  readonly calls: DrawCall[];
  readonly assetFailures: string[];
  world(): World;
  hold(action: ActionName): void;
  release(action: ActionName): void;
  tap(action: ActionName): void;
  logical(point: Vec3): Vec2;
  device(point: Vec2): { x: number; y: number };
  pixel(point: Vec2): [number, number, number, number];
  picture(point: Vec2): [number, number, number, number];
  dispose(): void;
}

export function rgba(color: string): [number, number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

function toDevice(world: World, point: Vec2): { x: number; y: number } {
  const view = world.viewport();
  return {
    x: Math.round(view.offsetX + point.x * view.scale),
    y: Math.round(view.offsetY + point.y * view.scale),
  };
}

function sample(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
): [number, number, number, number] {
  const { data } = ctx.getImageData(at.x, at.y, 1, 1);
  return [data[0], data[1], data[2], data[3]];
}

function recorder(
  target: CanvasRenderingContext2D,
  calls: DrawCall[],
): CanvasRenderingContext2D {
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
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);

  const stage = canvas(deviceWidth, deviceHeight);
  const screen = canvas(deviceWidth, deviceHeight);
  const ctx = screen.getContext("2d") as CanvasRenderingContext2D;
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  screen.getContext = (() => recorded) as typeof screen.getContext;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<Debug>({
    canvas: stage,
    screen,
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
    events.dispatchEvent(new KeyboardEvent(type, { code: ACTIONS[action].keys[0] }));
  };

  const picture = (): CanvasRenderingContext2D => {
    const copy = canvas(stage.width, stage.height);
    const target = copy.getContext("2d") as CanvasRenderingContext2D;
    target.drawImage(stage, 0, 0);
    return target;
  };

  return {
    engine,
    instance,
    stage,
    screen: ctx,
    calls,
    assetFailures,
    world: () => engine.world,
    hold: (action) => dispatch("keydown", action),
    release: (action) => dispatch("keyup", action),
    tap: (action) => {
      dispatch("keydown", action);
      dispatch("keyup", action);
    },
    logical: (point) => {
      const at = engine.world.camera.worldToLogical(point);
      return { x: at.x, y: at.y };
    },
    device: (point) => toDevice(engine.world, point),
    pixel: (point) => sample(ctx, toDevice(engine.world, point)),
    picture: (point) => sample(picture(), toDevice(engine.world, point)),
    dispose: () => engine.destroy(),
  };
}
```

The options handed to `createEngine` are the ones the case fixes: the design
size and the background. Everything else the build decided is inside the game
definition, which is what makes one validator suite serve every build of the
case.

The stage canvas is where the engine obtains its `webgl2` context and renders
the world pass, and Chromium renders it in software. The second canvas is handed
as `screen`, and the engine draws the screen layer through its 2D context: the
HUD, every other screen-space component, and the diagnostics overlay land on it,
and its pixels and its operations are what the rendering checks read. The
harness replaces `getContext` on the screen canvas before the engine is created,
so the context the engine obtains at construction is the recording proxy.

The cast to `GameDefinition<Debug>` states that the build's surface is the one
the spec names. The suite's `Debug` is declared in `validation/debug.ts` from
the instrumentation spec, and a build whose surface departs from it fails the
checks that drive it.

`SurfaceMetrics` supplies the element size, the device pixel ratio, and the
event target the engine attaches its key listeners to. The canvases stay outside
the document, so the surface is what gives them a size, and handing it a plain
`EventTarget` gives the validator the seam a player's keyboard uses: `hold` and
`release` dispatch a `KeyboardEvent` carrying the bound code, which drives the
action through the bindings the game registered and reaches the simulation
through the player controller.

`world()` reads `engine.world` on every call. A transition rebuilds the world,
so a check that travels holds the engine and asks for the world again rather
than holding a world across the transition. `engine.debug` is the object the
build's `initialize` returned, and a check drives it directly:
`engine.debug.placeRunner(at)` poses, and `engine.debug.snapshot()` reads.

`logical` converts through the camera and `device` through the viewport, and the
two are separate because the two passes are. `worldToLogical` applies the
camera's pose and projection at the design aspect, so a check names a world
point and reads the logical point the world pass draws it at. The viewport
applies the scale and the letterbox offsets, so a check names a logical point
and reads the device pixel the screen layer drew it into; a screen-space
component is already in logical units, so its position goes through the second
map alone.

`pixel` samples the screen layer and `picture` samples the stage canvas. The
stage holds a `webgl2` context, so `picture` draws it into a 2D canvas the
harness makes and reads that, the same way the engine's recorder composes a
frame. What it reads is the world pass with the screen layer composited over it,
so a sample under the HUD is the HUD's fill and a sample elsewhere is what the
world pass rendered.

Subscribing before `engine.initialize()` is what makes an asset failure visible.
Construction runs no game code, so the handler is attached in time to observe
the instance's own initialization and the start level's `load`.

## Stepping the simulation

A [`ConstantClock`](/engines/structured-3d/apis/clocks/) makes each frame
worth a known step, so a duration is a frame count and the arithmetic a check
asserts is the arithmetic the specification states. The validator poses the
scenario through the debug surface, advances, and reads a snapshot back.

```ts
// validation/simulation.test.ts
import { ConstantClock, vec3, type Vec3 } from "@clockwyrks/structured-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  ARENA_WIDTH,
  DASH_SECONDS,
  DASH_SPEED,
  RUNNER_SPEED,
  TAGS,
} from "../src/constants";
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
  engine.debug.placeRunner(vec3(0, 0, 0));

  harness.hold("right");
  await engine.advance(60);

  const { runner } = engine.debug.snapshot();
  expect(engine.frame().count).toBe(60);
  expect(engine.frame().timeMs).toBeCloseTo(1000, 6);
  expect(runner.x).toBeCloseTo(RUNNER_SPEED, 2);
  expect(runner.y).toBeCloseTo(0, 6);
  expect(runner.z).toBeCloseTo(0, 6);
  expect(harness.assetFailures).toEqual([]);
});

it("spends the dash over its stated duration", async () => {
  const { engine } = harness;
  engine.debug.placeRunner(vec3(0, 0, 0));

  harness.hold("right");
  harness.tap("dash");
  await engine.advance(60);

  const dashed = DASH_SPEED * DASH_SECONDS;
  const walked = RUNNER_SPEED * (1 - DASH_SECONDS);
  expect(engine.debug.snapshot().runner.x).toBeCloseTo(dashed + walked, 2);
});

it("is blocked by the arena wall", async () => {
  const { engine } = harness;
  engine.debug.placeRunner(vec3(0, 0, 0));

  const hits: { wall: boolean; normal: Vec3 }[] = [];
  engine.events.on("hit", ({ a, manifold }) => {
    hits.push({ wall: a.hasTag(TAGS.wall), normal: manifold.normal });
  });

  harness.hold("right");
  await engine.advance(120);

  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].wall).toBe(true);
  expect(hits[0].normal.x).toBeCloseTo(-1, 6);
  expect(hits[0].normal.y).toBeCloseTo(0, 6);
  expect(engine.debug.snapshot().runner.x).toBeLessThan(ARENA_WIDTH / 2);
});
```

Sixty frames of `1000 / 60` milliseconds are one second exactly, so the runner
covers 4 units along `+X` and the frame counter reads 60. Each snapshot is taken
after the advance, so it reads the world the frame left rather than the one the
pose built. The dash costs a quarter of that second at 12 units per second and
the remaining three quarters run at the walking speed, which is 3 units plus 3.

The third check reads a collision at the arena wall, which the case's
specification declares, so the check runs against every build and a build with
an open field fails it. Two seconds of walking cover 8 units and the inner face
of the right wall stands at `x = 8`, so the runner meets it with its radius to
spare and the wall keeps its center inside the arena.

A `hit` names the actor with the lower `id` as `a`. The walls are declared
actors and the runner is spawned by the game mode, so the wall is always `a` and
the manifold's normal points from the wall toward the runner, along `-X` for a
sphere against the face of a box, with no `y` component.

## Asserting on the world and the actors

The engine's own object model is what a check reads. A suite finds actors by
tag, reads the match off the game state, and observes a transition on
`engine.events`, and the debug surface poses the situation each check reads.

```ts
// validation/world-and-actors.test.ts
import { vec3 } from "@clockwyrks/structured-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LEVELS, ORB_COUNT, ORB_POINTS, TAGS } from "../src/constants";
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
  expect(snapshot.runner).toEqual(player.pawn?.transform.position);

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
  engine.debug.placeOrb(0, vec3(2, 0, 0));
  engine.debug.placeRunner(vec3(2, 0, 0));
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
overlap of the two spheres, the mode ticks after it and requests the
transition, and the engine performs the request at the end of that same frame,
before the next one begins. No frame has stepped the summary world by the time
the check reads it.

## Asserting the diagnostics a build registered

Registering the values the case names is the build's part. Drawing the panel,
toggling it, and keeping it read-only are the engine's, so a check reads
`engine.diagnostics()` and asserts the names the build registered and what each
one reports for a posed world.

```ts
// validation/diagnostics.test.ts
import { ConstantClock } from "@clockwyrks/structured-3d";
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

## Asserting on the scene, the projection, and the pixels

Four readings of one frame answer four different questions. The scene says
what the pipeline placed for the world pass, the camera's projection says where
on the logical field a world point draws, the stage canvas's pixels say what the
world pass rendered there, and the screen layer's pixels and draw-call stream
say what the screen pass drew and what it asked for.

The canvases are 800 by 360 CSS pixels at a device pixel ratio of 2, so the fit
scales the 640 by 360 field by 2 and centers it in a 1600 by 720 backing store
with a 160 device pixel bar on each side. Both canvases share that backing
store. `getImageData` reads device pixels and ignores the context transform, so
the harness maps the logical point itself.

```ts
// validation/rendering.test.ts
import * as THREE from "three";
import { vec3 } from "@clockwyrks/structured-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BACKGROUND,
  CAMERA,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  HUD,
  HUD_COLOR,
  ORB_COLOR,
  ORB_POINTS,
  RUNNER_COLOR,
  SCORE_COLOR,
} from "../src/constants";
import { callsTo, createHarness, rgba, setsOf, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
});

afterEach(() => {
  harness.dispose();
});

function meshesColored(scene: THREE.Scene, color: string): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material as { color?: THREE.Color };
    if (material.color?.getHexString() === color.slice(1)) found.push(object);
  });
  return found;
}

it("places a mesh in the scene for each orb and for the runner", async () => {
  const { engine } = harness;
  engine.debug.keepOrbs(3);
  await engine.advance(1);
  engine.debug.placeRunner(vec3(2, 0, -1));
  await engine.advance(1);

  expect(meshesColored(engine.scene, ORB_COLOR)).toHaveLength(3);

  const [runner] = meshesColored(engine.scene, RUNNER_COLOR);
  expect(runner).toBeDefined();
  expect(runner.visible).toBe(true);
  const at = runner.getWorldPosition(new THREE.Vector3());
  expect(at.x).toBeCloseTo(2, 6);
  expect(at.y).toBeCloseTo(0, 6);
  expect(at.z).toBeCloseTo(-1, 6);
});

it("projects the runner to the center of the field at the origin", async () => {
  const { engine } = harness;
  engine.debug.placeRunner(vec3(0, 0, 0));
  await engine.advance(1);

  const camera = harness.world().camera;
  expect(camera.snapshot().position).toEqual(CAMERA.position);

  const origin = camera.worldToLogical(vec3(0, 0, 0));
  expect(origin.visible).toBe(true);
  expect(origin.x).toBeCloseTo(DESIGN_WIDTH / 2, 3);
  expect(origin.y).toBeCloseTo(DESIGN_HEIGHT / 2, 3);

  const right = harness.logical(vec3(3, 0, 0));
  expect(right.x).toBeGreaterThan(origin.x);
  expect(right.y).toBeCloseTo(origin.y, 3);
  expect(camera.worldToLogical(vec3(0, 24, 18)).visible).toBe(false);
});

it("renders the runner where the camera projects it", async () => {
  const { engine } = harness;
  engine.debug.placeRunner(vec3(0, 0, 0));
  await engine.advance(1);

  const center = harness.logical(vec3(0, 0, 0));
  expect(harness.picture({ x: -40, y: 10 })).toEqual(rgba(BACKGROUND));
  expect(harness.picture(center)).not.toEqual(rgba(BACKGROUND));

  engine.renderer.setMode("unlit");
  await engine.advance(1);
  expect(harness.picture(center)).toEqual(rgba(RUNNER_COLOR));
});

it("draws the HUD panel on the screen layer in the color the case fixes", async () => {
  const { engine } = harness;
  await engine.advance(1);

  expect(harness.device({ x: 0, y: 0 })).toEqual({ x: 160, y: 0 });
  expect(harness.pixel({ x: HUD.x - HUD.width / 2 + 6, y: HUD.y })).toEqual(rgba(HUD_COLOR));
  const corner = { x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT - 20 };
  expect(harness.pixel(corner)).toEqual([0, 0, 0, 0]);
});

it("writes the score over the panel", async () => {
  const { engine, calls } = harness;
  engine.debug.keepOrbs(2);
  await engine.advance(1);
  engine.debug.placeOrb(0, vec3(2, 0, 0));
  engine.debug.placeRunner(vec3(2, 0, 0));
  await engine.advance(1);

  calls.length = 0;
  await engine.advance(1);

  const fills = setsOf(calls, "fillStyle");
  expect(fills).toContain(HUD_COLOR);
  expect(fills.at(-1)).toBe(SCORE_COLOR);
  expect(fills.indexOf(HUD_COLOR)).toBeLessThan(fills.lastIndexOf(SCORE_COLOR));

  const texts = callsTo(calls, "fillText");
  expect(texts.at(-1)?.[0]).toBe(`score ${ORB_POINTS}`);
});

it("draws outlines alone on the screen layer in wireframe", async () => {
  const { engine, calls } = harness;
  engine.renderer.setMode("wireframe");

  calls.length = 0;
  await engine.advance(1);

  expect(engine.renderer.mode()).toBe("wireframe");
  expect(callsTo(calls, "fill")).toHaveLength(0);
  expect(callsTo(calls, "fillText")).toHaveLength(0);
  expect(callsTo(calls, "stroke").length).toBeGreaterThan(0);
  expect(callsTo(calls, "strokeText").length).toBeGreaterThan(0);
});
```

The scene check reads `engine.scene` for what the pipeline placed. A mesh is
found by traversal and identified by its material's color, which is the color
the case fixes; the pipeline places the runner's mesh at the pawn's world
transform every frame, so its world position is the position the pose assigned.
The material's class is the build's choice, so the check reads `color` off it
as a field every mesh material carries. The scene is read after an advance,
because the pipeline syncs objects during the frame.

The projection check reads `world.camera` as it stands. The case fixes the
camera on the plane `x = 0`, looking at the origin, so the origin lands at the
center of the logical field and a point moved along `+X` moves right across it
at the same height. A point behind the camera reports `visible: false`, and a
check about where something appears on screen reads `worldToLogical` rather
than pixels.

The picture check reads the stage canvas. A logical point left of the field
lands in the letterbox bar, which the pipeline clears to `background` along with
the rest of the canvas, and the point the runner projects to is where the world
pass drew it. Under `shaded` that pixel is lit, so the claim is that it differs
from the background; under `unlit` the pipeline draws the material's base color
with the lights ignored, so the same pixel is the runner's color exactly.

The screen layer is transparent wherever the screen pass drew nothing, so a
pixel outside the HUD reads as four zeros and the 3D picture beneath it is on
the stage canvas alone. A pixel inside the panel and left of the readout is the
panel's fill exactly, and the letterbox offset the harness reports is the one
the fit computed. Sample at least two logical pixels inside a shape's edge,
since an edge is anti-aliased.

The stream check takes two frames after the pose. The first frame's collision
pass finds the overlap and the mode scores it; the second frame draws the
readout the HUD actor rewrote from the state, and clearing `calls` between them
keeps the stream to that one frame. The panel sits on `HUD_LAYER` and the
readout on `SCORE_LAYER`, so the panel's fill is set before the readout's and
the readout's `fillText` is the last in the stream. The stream also carries the
engine's own clear and transform, so a check names the operations the pipeline
made for the game.

Under `wireframe` the screen pass strokes each component's outline: a shape
through `stroke` and a text through `strokeText`, at one width, with no fill.
The same mode draws each mesh as its edges in the world pass, which the stage
canvas's pixels show and a recording carries.

All four readings come from the same frames, because the recording proxy
forwards every call to the real context, the scene is the object the pipeline
maintains, and the stage canvas holds the frame most recently rendered. One
advance therefore produces a scene to inspect, a projection to compute, two
pixel buffers to sample, and a call list to read.

## Asserting on actions and cues

Dispatching a key event at the surface's event target sets the action the game
bound that key to, and the player controller reads it on the next frame.
`engine.events.on` returns the function that removes the handler, so a check
subscribes, runs the scenario, and asserts against what the handler collected.

```ts
// validation/input-and-audio.test.ts
import { vec3, type Vec3 } from "@clockwyrks/structured-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ORB_POINTS, TAGS } from "../src/constants";
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
  engine.debug.placeRunner(vec3(0, 0, 0));

  const played: { cue: string; t: number; gain: number; at: Vec3 | null }[] = [];
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

it("plays the collect cue where the orb stood and scores it", async () => {
  const { engine } = harness;
  const world = harness.world();
  engine.debug.keepOrbs(2);
  await engine.advance(1);
  engine.debug.placeOrb(0, vec3(2, 0, 0));
  engine.debug.placeRunner(vec3(2, 0, 0));

  const collected: { gain: number; at: Vec3 | null }[] = [];
  const off = engine.events.on("cue:played", ({ cue, gain, at }) => {
    if (cue === "collect") collected.push({ gain, at });
  });

  await engine.advance(1);
  off();

  expect(collected).toHaveLength(1);
  expect(collected[0].at).toEqual(vec3(2, 0, 0));
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
time the clock delivered rather than the real time the suite took to run. `at`
is the world point a positional cue was played at, as a copy, and `null` for an
unpositioned one, so the case's claim that the collect cue sounds from the orb
is read off the event with no audio device.

A muted bus still emits `cue:played`, reporting `gain: 0`. The mute state is
therefore checkable without an audio device, and a check of the mute action
reads the events rather than the sound.

## Emitting a recording

A suite holds the engine, so it captures the frames a build drew over exactly
the stretch of a scenario its check is about, as a
[recording](/engines/structured-3d/apis/recording/): a video of the frames the
engine drew, one video frame per engine frame, encoded as VP9 in a WebM
container and timestamped in simulated time. `stopRecording` resolves with a
`Recording` holding the video bytes, the frame size, one `RecordedFrame` per
video frame, and whether the frame bound ended the capture. A verdict unit
declares a `replay` output in the case manifest, the suite writes it, and the
runner collects it as the review item's media. The [recording
validators](/engines/structured-3d/validators/recording/) page carries the
declaration and the baseline.

The suite runs in the page and the media directory is on disk, so the write
crosses to the Node side through the `emitReplay` browser command the config
declares. The helper hands the bytes across as base64 and leaves a capture with
no frames unwritten.

```ts
// validation/replay.ts
import { commands } from "@vitest/browser/context";
import type { Recording } from "@clockwyrks/structured-3d";

declare module "@vitest/browser/context" {
  interface BrowserCommands {
    emitReplay: (output: string, video: string) => Promise<void>;
  }
}

export async function emitReplay(output: string, recording: Recording): Promise<void> {
  if (recording.frames.length === 0) return;
  await commands.emitReplay(output, toBase64(recording.video));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
```

The runner names the run's media directory in `TCAB_VALIDATION_MEDIA_DIR`, and
the command writes each declared output to
`$TCAB_VALIDATION_MEDIA_DIR/<the suite's staged path>/<output id>.webm`, deriving
the staged path from the suite's own `testPath`. The variable is absent when the
suites are run by hand, and the command writes nothing then, which keeps a local
`vitest run` to its assertions.

```ts
// validation/recording.test.ts
import { vec3 } from "@clockwyrks/structured-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DESIGN_HEIGHT, DESIGN_WIDTH, LEVELS } from "../src/constants";
import { createHarness, type Harness } from "./harness";
import { emitReplay } from "./replay";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("records the sweep that empties the arena", async () => {
  const { engine } = harness;
  engine.debug.keepOrbs(1);
  await engine.advance(1);
  engine.debug.placeOrb(0, vec3(3, 0, 0));
  engine.debug.placeRunner(vec3(0, 0, 0));

  engine.startRecording();
  harness.hold("right");
  await engine.advance(60);
  const recording = await engine.stopRecording();
  await emitReplay("sweep", recording);

  expect(recording.width).toBe(DESIGN_WIDTH);
  expect(recording.height).toBe(DESIGN_HEIGHT);
  expect(recording.frames).toHaveLength(60);
  expect(recording.frames[0].count).toBe(2);
  expect(recording.frames.at(-1)?.count).toBe(61);
  expect(recording.frames[0].deltaMs).toBeCloseTo(1000 / 60, 6);
  expect(recording.frames.at(-1)?.timeMs).toBeCloseTo(engine.frame().timeMs, 6);
  expect(recording.ended).toBe(false);
  expect(recording.video.length).toBeGreaterThan(0);
  expect(harness.world().level).toBe(LEVELS.summary);
});
```

The recorder is armed once the scenario is posed and disarmed once the behavior
has happened, so the reviewer's evidence opens on the situation the requirement
describes. Capture begins at the frame after `startRecording`, so the sixty
frames advanced are the sixty frames recorded, and each carries the engine's
frame counter, which continued from the one frame the setup ran, and the
simulated time through that frame. `ended` is `false` because the sixty frames
sit well inside the 3,600-frame bound.

The recording's size is the stage canvas's backing store when the recorder was
armed, which at the harness's default ratio of `1` is the design size. The
transition to `summary` happens part way through the stretch and the recorder
keeps capturing across it, so the later frames show the summary world, and the
engine's counter and accumulated time keep one timeline through the transition.

The recording is taken before the assertions run, so a failing check still hands
the reviewer the frames that failed it. Call `stopRecording` on every path that
armed the recorder, since a second `startRecording` while armed is refused.
