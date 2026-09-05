---
title: Input and Actions
---

A build that reads the player through the action registry: a hopper that runs
over the ground under a held analog steer, orbits its camera under a second
stick, jumps on a button edge, and pauses on another. Every key the build cares
about is declared once during initialization, and the simulation asks for
actions by name.

## index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hopper</title>
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
import { createEngine } from "@clockwyrks/simple-3d";
import { hopper } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#0b0f16",
  layout: "dual-stick-two-buttons",
  game: hopper,
});

await engine.initialize();
await engine.run();
```

`layout` selects the touch layout before anything is registered, so every action
in that layout's vocabulary is tagged with it as the game registers it.

## src/game.ts

```ts
import * as THREE from "three";
import type {
  ActionBinding,
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-3d";
import type { DeepReadonly } from "ts-essentials";

/** Every action `TOUCH_LAYOUTS["dual-stick-two-buttons"]` names, with its keys. */
const BINDINGS: Record<string, ActionBinding> = {
  "move-up": { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  "move-down": { keys: ["KeyS", "ArrowDown"], kind: "analog" },
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

const SIZE = 1;
const LIMIT = 12;
const RUN = 6;
const JUMP = 8;
const GRAVITY = 20;
export const TURN = 2;
export const ORBIT = 8;
const EYE_HEIGHT = 5;

export interface HopperState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vy: number;
  readonly yaw: number;
  readonly grounded: boolean;
  readonly paused: boolean;
  readonly jumps: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2 * LIMIT + SIZE, 2 * LIMIT + SIZE),
  new THREE.MeshStandardMaterial({ color: "#182231" }),
);
ground.rotation.x = -Math.PI / 2;

const body = new THREE.Mesh(
  new THREE.BoxGeometry(SIZE, SIZE, SIZE),
  new THREE.MeshStandardMaterial({ color: "#7fd1ff" }),
);
body.name = "hopper";

export const hopper: Game<HopperState, null> = {
  initialize(api: InitApi<HopperState>): [HopperState, null] {
    for (const [action, binding] of Object.entries(BINDINGS)) {
      api.input.register(action, binding);
    }

    api.scene.add(new THREE.HemisphereLight("#ffffff", "#223344", 1));
    api.scene.add(ground);
    api.scene.add(body);

    return [
      {
        x: 0,
        y: 0,
        z: 0,
        vy: 0,
        yaw: 0,
        grounded: true,
        paused: false,
        jumps: 0,
      },
      null,
    ];
  },

  update(state: DeepReadonly<HopperState>, api: UpdateApi, dt: number): HopperState {
    const paused = api.input.pressed("pause") ? !state.paused : state.paused;
    if (paused) return { ...state, paused };

    const turn = api.input.value("look-right") - api.input.value("look-left");
    const yaw = state.yaw + turn * TURN * dt;

    const forward = api.input.value("move-up") - api.input.value("move-down");
    const strafe = api.input.value("move-right") - api.input.value("move-left");
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const x = clamp(state.x + (cos * strafe - sin * forward) * RUN * dt, -LIMIT, LIMIT);
    const z = clamp(state.z - (sin * strafe + cos * forward) * RUN * dt, -LIMIT, LIMIT);

    const jumping = api.input.pressed("a") && state.grounded;
    const launched = jumping
      ? { vy: JUMP, grounded: false, jumps: state.jumps + 1 }
      : { vy: state.vy, grounded: state.grounded, jumps: state.jumps };

    const vy = launched.vy - GRAVITY * dt;
    const y = state.y + vy * dt;

    if (y <= 0) {
      return { ...launched, x, y: 0, z, vy: 0, yaw, grounded: true, paused };
    }
    return { ...launched, x, y, z, vy, yaw, paused };
  },

  render(state: DeepReadonly<HopperState>, api: RenderApi): void {
    body.position.set(state.x, state.y + SIZE / 2, state.z);
    body.material.color.set(state.grounded ? "#7fd1ff" : "#ffd479");

    api.camera.position.set(
      state.x + ORBIT * Math.sin(state.yaw),
      EYE_HEIGHT,
      state.z + ORBIT * Math.cos(state.yaw),
    );
    api.camera.lookAt(state.x, SIZE / 2, state.z);

    const { screen } = api;
    screen.fillStyle = "#e6edf6";
    screen.font = "16px monospace";
    screen.fillText(state.paused ? "paused" : `jumps ${state.jumps}`, 16, 28);
  },
};
```

## Held and edge reads

`value` is the held read. The eight stick actions are analog, so a key reports
`1` while it is down and a stick reports the component of its deflection in
that direction. Taking each axis as the difference of its two directions makes
holding both report `0`, and multiplying by `dt` keeps the distance traveled
proportional to the time the frame was worth.

The move stick is read relative to the camera. `yaw` is the angle the look
stick has turned the camera around the hopper, and rotating the stick's two
axes by it makes pushing forward carry the hopper away from the camera whatever
way the camera faces. `render` places the camera on the same circle from the
same `yaw`, so the picture and the steering agree.

`pressed` is the edge read, true exactly once per press however long the key is
held, and the call consumes the edge. Reading `a` once per frame is therefore
what makes one press cost one jump.

## Driven by a key

`update` reads names, and the registry resolves each name from whatever drove
it. `KeyD` and `ArrowRight` take `move-right` to `1` for as long as either is
down, `KeyL` takes `look-right` to `1`, `Space` arms the edge `a` reports on the
next frame, and a touch layout's own sticks and buttons drive the same names.

## Driven by a test

A test supplies a `surface`, which is where the engine reads its element size
and attaches its key listeners. Dispatching a key event on that event target
takes the same path a browser's key takes, so the suite exercises the build's
own bindings rather than a parallel entry point.

The test runs in the page under vitest's browser mode, so it creates the stage
canvas with `document.createElement("canvas")` and the engine builds its
renderer over it. The camera is read into the
[`View`](/engines/simple-3d/apis/view/) after every `render`, so a test reads
where the game put the camera off the view.

### tests/steering.test.ts

```ts
import { ConstantClock, createEngine } from "@clockwyrks/simple-3d";
import type { Engine, SurfaceMetrics } from "@clockwyrks/simple-3d";
import { expect, test } from "vitest";
import { ORBIT, TURN, hopper } from "../src/game";
import type { HopperState } from "../src/game";

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

function boot(): { engine: Engine<HopperState>; surface: TestSurface } {
  const surface = new TestSurface();
  const engine = createEngine({
    canvas: document.createElement("canvas"),
    width: WIDTH,
    height: HEIGHT,
    layout: "dual-stick-two-buttons",
    game: hopper,
    clock: new ConstantClock(1000 / 60),
    surface,
  });
  return { engine, surface };
}

test("a held steer moves the hopper right", async () => {
  const { engine, surface } = boot();
  const opening = await engine.initialize();

  key(surface.target, "keydown", "KeyD");
  await engine.advance(60);
  key(surface.target, "keyup", "KeyD");

  expect(engine.state.x).toBeGreaterThan(opening.x);
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

test("a held look turns the camera around the hopper", async () => {
  const { engine, surface } = boot();
  await engine.initialize();

  key(surface.target, "keydown", "KeyL");
  await engine.advance(60);
  key(surface.target, "keyup", "KeyL");

  const { x, yaw } = engine.state;
  const camera = engine.view().camera();
  expect(yaw).toBeCloseTo(TURN, 3);
  expect(camera.position.x).toBeCloseTo(x + ORBIT * Math.sin(yaw), 3);
  engine.destroy();
});
```

`engine.state` is the value the most recent frame left, so reading it after
`advance` reads the current frame. The value `initialize` resolved to is the
opening state and stays that value however many frames run, which is why
`opening.x` is the figure the first test compares against.

`ConstantClock` makes each of the 60 frames worth exactly `1000 / 60`
milliseconds, so the distance the first test measures is the distance one
simulated second of holding the key is worth, and the angle the third test
measures is one second of `TURN`. `engine.view().camera()` is the camera as it
stood at the most recent render, the one the sixtieth frame's `render` posed
from the state that frame left, so the snapshot's position is the position the
game computed from `yaw`.
