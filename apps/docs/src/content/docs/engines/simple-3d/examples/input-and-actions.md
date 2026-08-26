---
title: Input and Actions
---

A build that reads the player through the action registry: a rover that drives
over a floor under held analog axes, turns under the look pad's horizontal
axis, jumps on a button edge, and pauses on another. Every key the build cares
about is declared once during initialization, and the simulation asks for
actions by name.

## index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rover</title>
  </head>
  <body style="margin: 0; background: #0b0f16">
    <canvas
      id="game"
      style="display: block; width: 100vw; height: 100vh"
    ></canvas>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/simple-3d";
import { rover } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#0b0f16",
  layout: "stick-look-two-buttons",
  game: rover,
});

await engine.initialize();
await engine.run();
```

`layout` selects the touch layout before anything is registered, so every action
in that layout's vocabulary is tagged with it as the game registers it.

## src/game.ts

```ts
import {
  quatFromAxisAngle,
  rotateVec3,
  vec3Add,
  vec3Scale,
} from "@test-cabinet/simple-3d";
import type {
  ActionBinding,
  CameraState,
  Game,
  InitApi,
  LightState,
  Quat,
  RenderApi,
  Transform,
  UpdateApi,
  Vec3,
} from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

/** Every action `TOUCH_LAYOUTS["stick-look-two-buttons"]` names, with keys. */
const BINDINGS: Record<string, ActionBinding> = {
  "move-forward": { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  "move-back": { keys: ["KeyS", "ArrowDown"], kind: "analog" },
  "move-left": { keys: ["KeyA", "ArrowLeft"], kind: "analog" },
  "move-right": { keys: ["KeyD", "ArrowRight"], kind: "analog" },
  "look-up": { keys: ["KeyI"], kind: "analog" },
  "look-down": { keys: ["KeyK"], kind: "analog" },
  "look-left": { keys: ["KeyJ"], kind: "analog" },
  "look-right": { keys: ["KeyL"], kind: "analog" },
  a: { keys: ["Space"] },
  b: { keys: ["KeyE"] },
  confirm: { keys: ["Enter"] },
  back: { keys: ["Escape"] },
  pause: { keys: ["KeyP"] },
  mute: { keys: ["KeyM"] },
};

const FIELD = 14;
const RUN = 5;
const TURN = 2.5;
const JUMP = 6;
const GRAVITY = 18;

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const FORWARD: Vec3 = { x: 0, y: 0, z: -1 };
const RIGHT: Vec3 = { x: 1, y: 0, z: 0 };
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

const CAMERA: CameraState = {
  position: { x: 0, y: 10, z: 20 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.45),
  fovY: Math.PI / 3,
  near: 0.1,
  far: 100,
};

const LIGHTS: readonly LightState[] = [
  { type: "ambient", color: "#ffffff", intensity: 0.35 },
  {
    type: "directional",
    color: "#ffffff",
    intensity: 0.9,
    direction: { x: -0.5, y: -1, z: -0.5 },
  },
];

export interface RoverState {
  readonly position: Vec3;
  readonly heading: number;
  readonly vy: number;
  readonly grounded: boolean;
  readonly paused: boolean;
  readonly jumps: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export const rover: Game<RoverState, null> = {
  initialize(api: InitApi<RoverState>): [RoverState, null] {
    for (const [action, binding] of Object.entries(BINDINGS)) {
      api.input.register(action, binding);
    }

    return [
      {
        position: { x: 0, y: 0, z: 0 },
        heading: 0,
        vy: 0,
        grounded: true,
        paused: false,
        jumps: 0,
      },
      null,
    ];
  },

  update(state: DeepReadonly<RoverState>, api: UpdateApi, dt: number): RoverState {
    const paused = api.input.pressed("pause") ? !state.paused : state.paused;
    if (paused) return { ...state, paused };

    const turn = api.input.value("look-left") - api.input.value("look-right");
    const heading = state.heading + turn * TURN * dt;
    const facing = quatFromAxisAngle(UP, heading);

    const drive = api.input.value("move-forward") - api.input.value("move-back");
    const strafe = api.input.value("move-right") - api.input.value("move-left");
    const step = vec3Add(
      vec3Scale(rotateVec3(facing, FORWARD), drive * RUN * dt),
      vec3Scale(rotateVec3(facing, RIGHT), strafe * RUN * dt),
    );

    const jumping = api.input.pressed("a") && state.grounded;
    const vy = (jumping ? JUMP : state.vy) - GRAVITY * dt;
    const y = state.position.y + vy * dt;
    const grounded = y <= 0;

    return {
      position: {
        x: clamp(state.position.x + step.x, -FIELD, FIELD),
        y: grounded ? 0 : y,
        z: clamp(state.position.z + step.z, -FIELD, FIELD),
      },
      heading,
      vy: grounded ? 0 : vy,
      grounded,
      paused,
      jumps: jumping ? state.jumps + 1 : state.jumps,
    };
  },

  render(state: DeepReadonly<RoverState>, api: RenderApi): void {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    const ground: Transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: IDENTITY,
      scale: ONE,
    };
    scene.drawGeometry(scene.createPlane(30, 30), "#182231", ground);

    scene.drawGeometry(
      scene.createBox({ x: 0.9, y: 0.6, z: 1.4 }),
      state.grounded ? "#7fd1ff" : "#ffd479",
      {
        position: {
          x: state.position.x,
          y: state.position.y + 0.3,
          z: state.position.z,
        },
        rotation: quatFromAxisAngle(UP, state.heading),
        scale: ONE,
      },
    );

    scene.drawHudText(
      state.paused ? "paused" : `jumps ${state.jumps}`,
      { x: 16, y: 12 },
      { size: 16, color: "#e6edf6" },
    );
  },
};
```

## Held and edge reads

`value` is the held read. The move and look actions are analog, so a key
reports `1` while it is down and a touch stick reports the partial magnitude it
is deflected to. Taking each axis as the difference of its two opposed actions
makes holding both report `0`, and multiplying by `dt` keeps the distance and
the turn proportional to the time the frame was worth.

The two axes compose through the math functions. `quatFromAxisAngle` turns the
accumulated heading into an orientation, `rotateVec3` carries the local forward
and right vectors into world space, and the frame's step is the scaled sum. The
same orientation rotates the box in `render`, so the rover faces the way it
drives.

`pressed` is the edge read, true exactly once per press however long the key is
held, and the call consumes the edge. Reading `a` once per frame is therefore
what makes one press cost one jump.

## Driven by a key

`update` reads names, and the registry resolves each name from whatever drove
it. `KeyW` and `ArrowUp` take `move-forward` to `1` for as long as either is
down, `Space` arms the edge `a` reports on the next frame, and the layout's own
stick, pad, and buttons drive the same names.

## Driven by a test

A test supplies a `surface`, which is where the engine reads its element size
and attaches its key listeners. Dispatching a key event on that event target
takes the same path a browser's key takes, so the suite exercises the build's
own bindings rather than a parallel entry point.

### tests/driving.test.ts

```ts
import { createCanvas } from "@test-cabinet/headless-webgl2";
import { ConstantClock, createEngine } from "@test-cabinet/simple-3d";
import type { Engine, SurfaceMetrics } from "@test-cabinet/simple-3d";
import { expect, test } from "vitest";
import { rover } from "../src/game";
import type { RoverState } from "../src/game";

const WIDTH = 640;
const HEIGHT = 360;

class TestSurface implements SurfaceMetrics {
  readonly target = new EventTarget();

  cssWidth(): number {
    return WIDTH;
  }

  cssHeight(): number {
    return HEIGHT;
  }

  dpr(): number {
    return 1;
  }

  events(): EventTarget {
    return this.target;
  }
}

function key(
  target: EventTarget,
  type: "keydown" | "keyup",
  code: string,
): void {
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
}

function boot(): { engine: Engine<RoverState>; surface: TestSurface } {
  const surface = new TestSurface();
  const engine = createEngine({
    canvas: createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement,
    width: WIDTH,
    height: HEIGHT,
    layout: "stick-look-two-buttons",
    game: rover,
    clock: new ConstantClock(1000 / 60),
    surface,
  });
  return { engine, surface };
}

test("a held drive moves the rover forward", async () => {
  const { engine, surface } = boot();
  const opening = await engine.initialize();

  key(surface.target, "keydown", "KeyW");
  await engine.advance(60);
  key(surface.target, "keyup", "KeyW");

  expect(engine.state.position.z).toBeLessThan(opening.position.z);
  expect(engine.state.position.x).toBeCloseTo(opening.position.x, 6);
  engine.destroy();
});

test("a held jump button costs one jump", async () => {
  const { engine, surface } = boot();
  await engine.initialize();

  key(surface.target, "keydown", "Space");
  await engine.advance(120);

  expect(engine.state.jumps).toBe(1);
  engine.destroy();
});
```

`engine.state` is the value the most recent frame left, so reading it after
`advance` reads the current frame. The value `initialize` resolved to is the
opening state and stays that value however many frames run, which is why
`opening.position` is the figure the first test compares against. At the
opening heading of `0` the rover faces `-Z`, so a held drive lowers `z` and
leaves `x` where it was.

`ConstantClock` makes each of the 60 frames worth exactly `1000 / 60`
milliseconds, so the distance the first test measures is the distance one
simulated second of holding the key is worth. The canvas comes from
`@test-cabinet/headless-webgl2`, which serves the WebGL2 context the engine
renders through in Node.
