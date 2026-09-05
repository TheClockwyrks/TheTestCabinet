---
title: Input and Actions
---

A build that reads the player through the action registry: a hopper that runs
along the ground under a held analog steer, jumps on a button edge, and pauses
on another. Every key the build cares about is declared once during
initialization, and the simulation asks for actions by name.

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
import { createEngine } from "@clockwyrks/simple-2d";
import { hopper } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#0b0f16",
  layout: "dpad-4-two-buttons",
  game: hopper,
});

await engine.initialize();
await engine.run();
```

`layout` selects the touch layout before anything is registered, so every action
in that layout's vocabulary is tagged with it as the game registers it.

## src/game.ts

```ts
import type {
  ActionBinding,
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

/** Every action `TOUCH_LAYOUTS["dpad-4-two-buttons"]` names, with its keys. */
const BINDINGS: Record<string, ActionBinding> = {
  up: { keys: ["KeyW", "ArrowUp"] },
  down: { keys: ["KeyS", "ArrowDown"] },
  left: { keys: ["KeyA", "ArrowLeft"], kind: "analog" },
  right: { keys: ["KeyD", "ArrowRight"], kind: "analog" },
  a: { keys: ["Space"] },
  b: { keys: ["KeyE"] },
  confirm: { keys: ["Enter"] },
  back: { keys: ["Escape"] },
  pause: { keys: ["KeyP"] },
  mute: { keys: ["KeyM"] },
};

const SIZE = 32;
const GROUND = 320;
const RUN = 260;
const JUMP = -520;
const GRAVITY = 1400;

export interface HopperState {
  readonly x: number;
  readonly y: number;
  readonly vy: number;
  readonly grounded: boolean;
  readonly paused: boolean;
  readonly jumps: number;
}

export const hopper: Game<HopperState, null> = {
  initialize(api: InitApi<HopperState>): [HopperState, null] {
    for (const [action, binding] of Object.entries(BINDINGS)) {
      api.input.register(action, binding);
    }

    return [
      {
        x: 96,
        y: GROUND - SIZE,
        vy: 0,
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

    const steer = api.input.value("right") - api.input.value("left");
    const limit = api.viewport().width - SIZE;
    const x = Math.min(Math.max(state.x + steer * RUN * dt, 0), limit);

    const jumping = api.input.pressed("a") && state.grounded;
    const launched = jumping
      ? { vy: JUMP, grounded: false, jumps: state.jumps + 1 }
      : { vy: state.vy, grounded: state.grounded, jumps: state.jumps };

    const vy = launched.vy + GRAVITY * dt;
    const y = state.y + vy * dt;

    if (y >= GROUND - SIZE) {
      return { ...launched, x, y: GROUND - SIZE, vy: 0, grounded: true, paused };
    }
    return { ...launched, x, y, vy, paused };
  },

  render(state: DeepReadonly<HopperState>, api: RenderApi): void {
    const { ctx } = api;
    const { width, height } = api.viewport();

    ctx.fillStyle = "#182231";
    ctx.fillRect(0, GROUND, width, height - GROUND);

    ctx.fillStyle = state.grounded ? "#7fd1ff" : "#ffd479";
    ctx.fillRect(state.x, state.y, SIZE, SIZE);

    ctx.fillStyle = "#e6edf6";
    ctx.font = "16px monospace";
    ctx.fillText(state.paused ? "paused" : `jumps ${state.jumps}`, 16, 28);
  },
};
```

## Held and edge reads

`value` is the held read. `left` and `right` are analog, so a key reports `1`
while it is down and a touch slider reports the partial magnitude it is pushed
to. Taking the axis as the difference of the two directions makes holding both
report `0`, and multiplying by `dt` keeps the distance traveled proportional to
the time the frame was worth.

`pressed` is the edge read, true exactly once per press however long the key is
held, and the call consumes the edge. Reading `a` once per frame is therefore
what makes one press cost one jump.

## Driven by a key

`update` reads names, and the registry resolves each name from whatever drove
it. `KeyD` and `ArrowRight` take `right` to `1` for as long as either is down,
`Space` arms the edge `a` reports on the next frame, and a touch layout's own
controls drive the same names.

## Driven by a test

A test supplies a `surface`, which is where the engine reads its element size
and attaches its key listeners. Dispatching a key event on that event target
takes the same path a browser's key takes, so the suite exercises the build's
own bindings rather than a parallel entry point.

### tests/steering.test.ts

```ts
import { createCanvas } from "@napi-rs/canvas";
import { ConstantClock, createEngine } from "@clockwyrks/simple-2d";
import type { Engine, SurfaceMetrics } from "@clockwyrks/simple-2d";
import { expect, test } from "vitest";
import { hopper } from "../src/game";
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
    canvas: createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement,
    width: WIDTH,
    height: HEIGHT,
    layout: "dpad-4-two-buttons",
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
```

`engine.state` is the value the most recent frame left, so reading it after
`advance` reads the current frame. The value `initialize` resolved to is the
opening state and stays that value however many frames run, which is why
`opening.x` is the figure the first test compares against.

`ConstantClock` makes each of the 60 frames worth exactly `1000 / 60`
milliseconds, so the distance the first test measures is the distance one
simulated second of holding the key is worth.
