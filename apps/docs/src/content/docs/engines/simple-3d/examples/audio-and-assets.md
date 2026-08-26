---
title: Audio and Assets
---

A build that loads what it draws and plays two kinds of cue: a mesh and a
produced `.wav` are resolved during initialization and held in the state, a
synthesized cue sounds on a control edge, and the file-backed cue sounds when
the skiff reaches a wall. A subscription to `asset:failed` puts a missing file
on screen.

## Where the files live

Every path a game names resolves under the asset root, which is `assets/`
relative to the page the build is served from.

```
assets/
  meshes/skiff.glb
  audio/impact.wav
```

`textures/beacon.png` names a file this workspace holds no copy of, which is
the load the notice on screen reports.

## index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Skiff</title>
  </head>
  <body style="margin: 0; background: #05060a">
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
import { skiff } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#05060a",
  game: skiff,
});

engine.events.on("asset:failed", (event) => {
  console.warn(`asset failed: ${event.path} (${event.reason})`);
});

const controller = new AbortController();
window.addEventListener("pagehide", () => controller.abort());

await engine.initialize();
await engine.run({ signal: controller.signal });
engine.destroy();
```

The engine exists before any loading happens, so the subscription is in place
for the loads the game's own `initialize` performs. The controller is how the
page halts the loop, and `destroy` runs once the loop has stopped.

## src/game.ts

```ts
import { quatFromAxisAngle } from "@test-cabinet/simple-3d";
import type {
  CameraState,
  Game,
  InitApi,
  LightState,
  MeshHandle,
  Quat,
  RenderApi,
  TextureHandle,
  Transform,
  UpdateApi,
  Vec3,
} from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

const SPEED = 6;
const WALL = 7;

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

const CAMERA: CameraState = {
  position: { x: 0, y: 6, z: 14 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.35),
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

function at(x: number, y: number, z: number): Transform {
  return { position: { x, y, z }, rotation: IDENTITY, scale: ONE };
}

export interface SkiffState {
  readonly ship: MeshHandle;
  readonly half: number;
  readonly beacon: TextureHandle | null;
  readonly notice: string | null;
  readonly x: number;
  readonly againstWall: boolean;
}

export const skiff: Game<SkiffState, null> = {
  async initialize(api: InitApi<SkiffState>): Promise<[SkiffState, null]> {
    api.input.register("left", { keys: ["KeyA", "ArrowLeft"], kind: "analog" });
    api.input.register("right", {
      keys: ["KeyD", "ArrowRight"],
      kind: "analog",
    });
    api.input.register("mute", { keys: ["KeyM"] });

    api.audio.define("thrust", {
      wave: "sawtooth",
      freq: 90,
      freqTo: 140,
      gain: 0.25,
      durationMs: 120,
    });

    const failed: string[] = [];
    const off = api.events.on("asset:failed", (event) => {
      failed.push(`${event.path} unavailable: ${event.reason}`);
    });

    const [ship] = await Promise.all([
      api.assets.loadMesh("meshes/skiff.glb"),
      api.audio.load("impact", "audio/impact.wav"),
    ]);

    const beacon = await api.assets
      .loadTexture("textures/beacon.png")
      .catch(() => null);
    off();

    const state: SkiffState = {
      ship,
      half: (ship.bounds.max.x - ship.bounds.min.x) / 2,
      beacon,
      notice: failed[0] ?? null,
      x: 0,
      againstWall: false,
    };
    return [state, null];
  },

  update(state: DeepReadonly<SkiffState>, api: UpdateApi, dt: number): SkiffState {
    if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

    const startedLeft = api.input.pressed("left");
    const startedRight = api.input.pressed("right");
    if (startedLeft || startedRight) api.audio.play("thrust");

    const steer = api.input.value("right") - api.input.value("left");
    const limit = WALL - state.half;
    const moved = state.x + steer * SPEED * dt;
    const clamped = Math.min(Math.max(moved, -limit), limit);
    const againstWall = clamped !== moved;

    if (againstWall && !state.againstWall) api.audio.play("impact");
    return { ...state, x: clamped, againstWall };
  },

  render(state: DeepReadonly<SkiffState>, api: RenderApi): void {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    scene.drawGeometry(scene.createPlane(18, 10), "#182231", at(0, 0, 0));
    const wall = scene.createBox({ x: 0.5, y: 1.5, z: 10 });
    scene.drawGeometry(wall, "#31405a", at(-7.25, 0.75, 0));
    scene.drawGeometry(wall, "#31405a", at(7.25, 0.75, 0));

    scene.drawMesh(state.ship, at(state.x, 0.5, 0));

    if (state.beacon !== null) {
      scene.drawBillboard(state.beacon, { x: 0, y: 3.5, z: -3 }, { x: 2, y: 2 });
    }

    if (state.notice !== null) {
      scene.drawHudText(state.notice, { x: 16, y: 14 }, {
        size: 14,
        color: "#ffb4a2",
      });
    }
  },
};
```

## A state with everything present

`initialize` returns once every load it awaited has resolved, so `ship` is a
`MeshHandle` and the `impact` cue is playable from the first frame. `update`
and `render` read the fields directly, and the state type declares each of them
as present. A handle is an engine-owned value: the game holds it in its state
and hands it back to `drawMesh`, and `half` reads the ship's width off
`ship.bounds` once so the clamp is stated against the mesh the file carries.

`beacon` is optional to this build, so its load is turned into a value: the
texture when it arrives, drawn as a camera-facing billboard, and `null` when it
does not. That decision is made during initialization as well, which keeps the
render's test a question about the design rather than about timing.

## The two kinds of cue

`define` declares a synthesized cue from a waveform, a frequency, an optional
sweep, a gain, and a duration in milliseconds. `load` binds a cue name to an
audio file under the asset root, which is how a clip produced by the
[audio asset-generation](/testing/asset-generation/audio-binaries/) tools is
played. Both are played by name from `update` through `api.audio.play`, and
either kind is looped by name through `api.audio.loop` and ended through
`api.audio.stop`. The bus is non-spatial, so where the skiff is on screen never
enters a cue.

Reading `left` and `right` into locals before the `||` keeps both edges
consumed, so a frame that starts two directions at once leaves nothing armed for
the next frame to replay.

## Observing a failed load

`api.events.on("asset:failed", handler)` runs the handler at the moment the load
fails, and returns the function that removes it. Every load this build performs
is awaited inside `initialize`, so the handler collects each reason while the
loads run, the subscription is removed once they have settled, and the first
reason is placed in the state that `initialize` returns. The frames that draw
the notice read it from there like any other field.

The payload names the path the game asked for, the URL it resolved to, and the
reason, so the notice on screen identifies the file to add to `assets/`. The
same event reaches any subscriber the caller attached to `engine.events` before
`initialize` ran.
