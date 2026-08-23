---
title: Audio and Assets
---

A build that loads what it draws and plays two kinds of cue: a sprite and a
produced `.wav` are resolved during initialization and held in the state, a
synthesized cue sounds on a control edge, and the file-backed cue sounds when
the ship reaches a wall. A subscription to `asset:failed` puts a missing file on
screen.

## Where the files live

Every path a game names resolves under the asset root, which is `assets/`
relative to the page the build is served from.

```
assets/
  sprites/ship.png
  audio/impact.wav
```

`sprites/banner.png` names a file this workspace holds no copy of, which is the
load the notice on screen reports.

## index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Runner</title>
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
import { createEngine } from "@test-cabinet/simple-2d";
import { runner } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#05060a",
  game: runner,
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
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";

const SHIP = 32;
const SPEED = 300;

interface Notice {
  text: string | null;
}

export interface RunnerState {
  ship: ImageBitmap;
  banner: ImageBitmap | null;
  notice: Notice;
  x: number;
  y: number;
  againstWall: boolean;
}

export const runner: Game<RunnerState, null> = {
  async initialize(api: InitApi): Promise<[RunnerState, null]> {
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

    const notice: Notice = { text: null };
    api.events.on("asset:failed", (event) => {
      notice.text = `${event.path} unavailable: ${event.reason}`;
    });

    const [ship] = await Promise.all([
      api.assets.loadImage("sprites/ship.png"),
      api.audio.load("impact", "audio/impact.wav"),
    ]);

    const banner = await api.assets
      .loadImage("sprites/banner.png")
      .catch(() => null);

    const { width, height } = api.viewport();
    const state: RunnerState = {
      ship,
      banner,
      notice,
      x: width / 2,
      y: height - 64,
      againstWall: false,
    };
    return [state, null];
  },

  update(state: RunnerState, api: UpdateApi, dt: number): void {
    if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

    const startedLeft = api.input.pressed("left");
    const startedRight = api.input.pressed("right");
    if (startedLeft || startedRight) api.audio.play("thrust");

    const steer = api.input.value("right") - api.input.value("left");
    const half = SHIP / 2;
    const limit = api.viewport().width - half;
    const moved = state.x + steer * SPEED * dt;
    const clamped = Math.min(Math.max(moved, half), limit);

    if (clamped !== moved && !state.againstWall) api.audio.play("impact");
    state.againstWall = clamped !== moved;
    state.x = clamped;
  },

  render(state: RunnerState, api: RenderApi): void {
    const { ctx } = api;
    const { width } = api.viewport();

    if (state.banner !== null) {
      ctx.drawImage(state.banner, (width - state.banner.width) / 2, 56);
    }

    ctx.drawImage(state.ship, state.x - SHIP / 2, state.y - SHIP / 2);

    if (state.notice.text !== null) {
      ctx.fillStyle = "#ffb4a2";
      ctx.font = "14px monospace";
      ctx.fillText(state.notice.text, 16, 28);
    }
  },
};
```

## A state with everything present

`initialize` returns once every load it awaited has resolved, so `ship` is an
`ImageBitmap` and the `impact` cue is playable from the first frame. `update`
and `render` read the fields directly, and the state type declares each of them
as present.

`banner` is optional to this build, so its load is turned into a value: the
bitmap when it arrives and `null` when it does not. That decision is made during
initialization as well, which keeps the render's test a question about the
design rather than about timing.

## The two kinds of cue

`define` declares a synthesized cue from a waveform, a frequency, an optional
sweep, a gain, and a duration in milliseconds. `load` binds a cue name to an
audio file under the asset root, which is how a clip produced by the
[audio asset-generation](/testing/asset-generation/audio-binaries/) tools is
played. Both are played by name from `update` through `api.audio.play`.

Reading `left` and `right` into locals before the `||` keeps both edges
consumed, so a frame that starts two directions at once leaves nothing armed for
the next frame to replay.

## Observing a failed load

`api.events.on("asset:failed", handler)` runs the handler at the moment the load
fails, and returns the function that removes it. Writing the reason into a box
the state holds is what carries it from initialization to the frames that draw
it.

The payload names the path the game asked for, the URL it resolved to, and the
reason, so the notice on screen identifies the file to add to `assets/`. The
same event reaches any subscriber the caller attached to `engine.events` before
`initialize` ran.
