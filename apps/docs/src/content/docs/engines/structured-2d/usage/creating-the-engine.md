---
title: Creating the Engine
---

The engine is an ordinary dependency of the build's workspace, already present
in its `package.json`. One import brings in the factory.

```ts
import { createEngine } from "@clockwyrks/structured-2d";
```

The framework classes, the built-in components, the clock catalogue, the touch
layout catalogue, the viewport functions, and every type a game names come from
the same specifier.

```ts
import {
  createEngine,
  GameInstance,
  PacedClock,
  TOUCH_LAYOUTS,
} from "@clockwyrks/structured-2d";
import type {
  Engine,
  GameDefinition,
  InitApi,
} from "@clockwyrks/structured-2d";
```

## Pick a logical design size

The width and height handed to `createEngine` are the logical field the camera
projects into, and they stay fixed for the life of the build. Choose a size that
suits the game's aspect ratio and state every speed, size, and distance in world
units of the same scale; the engine fits that field onto whatever size the page
gives the canvas.

A landscape action game is comfortable at `640 × 360`, a puzzle board at
`480 × 640`. A world's camera starts centered on the field at a zoom of `1`, so
world coordinates and logical coordinates coincide until the game moves it.

Keep the size in the build's own `constants` module, so the game's tunables and
the engine's options read the same numbers.

```ts
export const WIDTH = 640;
export const HEIGHT = 360;
```

## Write the game definition

The engine drives one
[`GameDefinition`](/engines/structured-2d/apis/game-instance/). It names the
level registry, the level to open first, and the game instance class kept across
every level.

```ts
import type { GameDefinition } from "@clockwyrks/structured-2d";
import { Arcade } from "./instance";
import { Ball, Paddle, Wall } from "./actors";
import { MenuMode, MatchMode } from "./modes";
import { HEIGHT, WIDTH } from "./constants";

export const game: GameDefinition<null> = {
  instance: Arcade,
  startLevel: "title",
  levels: {
    title: { mode: MenuMode },
    match: {
      mode: MatchMode,
      actors: [
        { type: Wall, transform: { y: 0 }, tags: ["wall"] },
        { type: Wall, transform: { y: HEIGHT }, tags: ["wall"] },
        { type: Paddle, transform: { x: 40, y: HEIGHT / 2 }, tags: ["player"] },
        {
          type: Ball,
          transform: { x: WIDTH / 2, y: HEIGHT / 2 },
          tags: ["ball"],
        },
      ],
      async load(api) {
        await api.audio.load("bounce", "sfx/bounce.wav");
      },
    },
  },
};
```

Each entry of `levels` is a description rather than a live object. The engine
builds a world from it when the level opens, and builds a fresh one on every
later transition back to it. What a level places and what it loads is covered
under [levels and worlds](/engines/structured-2d/usage/levels-and-worlds/).

The instance class is where the game's cross-level surface is declared. It
registers the action bindings, defines the cues, and loads the assets the whole
game needs.

```ts
import { GameInstance } from "@clockwyrks/structured-2d";
import type { InitApi } from "@clockwyrks/structured-2d";

export class Arcade extends GameInstance<null> {
  best = 0;

  override async initialize(api: InitApi): Promise<null> {
    api.input.register("up", { keys: ["KeyW", "ArrowUp"] });
    api.input.register("down", { keys: ["KeyS", "ArrowDown"] });
    api.audio.define("score", { freq: 660, durationMs: 90 });
    api.diagnostics.register("best", () => this.best);
    return null;
  }
}
```

`initialize` returns the [debug surface](/engines/structured-2d/usage/debug/)
a caller drives the build through, and a game with none returns `null`. Leaving
`instance` out of the definition uses `GameInstance` itself. A game that
declares bindings, cues, or assets supplies its own subclass.

## Create it once

`createEngine` binds the definition and builds the engine over the canvas. It
runs synchronously and runs no game code, so the engine exists before anything
the game does is observable.
[`engine.initialize`](/engines/structured-2d/apis/engine/) then builds the
instance and opens the start level, and `engine.run` drives frames from there.

```ts
import { createEngine } from "@clockwyrks/structured-2d";
import { game } from "./game";
import { HEIGHT, WIDTH } from "./constants";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing #game canvas");

const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  game,
  background: "#101018",
});

await engine.initialize();
await engine.run();
```

`initialize` resolves once the instance has run its `initialize`, the start
level's `load` has resolved, its actors are spawned and have begun play, and its
game mode has begun play. It resolves to the instance, so a caller that wants
the game's own object holds what it returns.

## Subscribe before initializing

Subscriptions live on the engine, so one made before `initialize` observes the
start level being built and every transition after it. That ordering is what
lets a build watch loading as it happens rather than infer it afterwards.

```ts
engine.events.on("asset:failed", (event) => {
  console.error(`asset ${event.path} failed: ${event.reason}`);
});

engine.events.on("world:opened", (event) => {
  console.info(`level ${event.level} is live`);
});

const instance = await engine.initialize();
```

Reading `engine.instance`, `engine.world`, or `engine.debug` before `initialize`
resolves throws, naming the ordering, so the subscription is the way to observe
the start level rather than a poll.

## The remaining options

| Option | Effect |
| --- | --- |
| `background` | A CSS color the whole canvas is filled with before every frame. Left out, the frame clears to transparency and the page shows through behind the game. |
| `imageSmoothing` | Whether an image the fit scales is resampled bilinearly. Defaults to `true`; `false` samples nearest-neighbor, which is the setting for pixel art. |
| `layout` | Selects a touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers as actions. |
| `assetRoot` | The root every asset path resolves under. Defaults to `assets/`. |
| `surface` | Where the engine reads element size and device pixel ratio and attaches its listeners. Defaults to the canvas and its owning document. |

```ts
const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  game,
  layout: "dpad-4-two-buttons",
  imageSmoothing: false,
  assetRoot: "assets/",
});
```

A build in the browser takes the default surface. Supplying one is how a
validator runs the same engine over a canvas with no document behind it.

## Size the canvas

The element's size is the page's business and the fit is the engine's. Give the
canvas a size in whatever CSS units the page wants, inline or through a
stylesheet, and leave the `width` and `height` attributes alone.

```html
<canvas id="game" style="width: 100vw; height: 100vh; display: block"></canvas>
```

The engine pins a fixed pixel size onto the canvas only while its reported size
still matches those attributes, which is what stops the backing store from
feeding back into the next measurement. A canvas that fills a sized wrapper
takes the same form, with `width: 100%; height: 100%`.

The engine reads the laid-out size at the top of every frame and recomputes the
fit to match the device pixel ratio, so a window resize needs no handler and no
code in the game.

## Choose a clock

A [clock](/engines/structured-2d/apis/clocks/) decides what each frame's delta
is, and the engine holds exactly one. A build that omits the option gets a
`WallClock`, which reports the real time each frame took, clamped so a tab that
stops receiving frames resumes as though the game paused for the gap.

```ts
const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  game,
  clock: new PacedClock(60),
});
```

A `PacedClock` holds a cadence: it declines the ticks that arrive between grid
slots and reports one fixed interval on the ticks it accepts. Choose it for a
game whose feel depends on a steady rate, and for a build whose simulated time
should match the rate it targets.

`engine.setClock` replaces the clock in place, and the frame counter and
accumulated time carry over. The scripted clocks are what a validator installs
to step a scenario reproducibly with `engine.advance`.

## Tearing down

A game that runs for the life of the page never needs to be torn down. Two
separate acts stop it when a build mounts the game into a view that goes away.

An `AbortSignal` passed to `run` halts the loop and leaves the engine usable, so
the same teardown path that cancels everything else cancels the loop with it.

```ts
const controller = new AbortController();
await engine.run({ signal: controller.signal });
```

`engine.destroy()` closes the world, which ends play for its controllers,
actors, and game mode, then runs the instance's `shutdown`. It halts the loop
and detaches every listener. It is idempotent, and it resolves any promise `run`
returned.

```ts
engine.destroy();
```
