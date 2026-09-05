---
title: Creating the Engine
---

The engine is an ordinary dependency of the build's workspace, already present
in its `package.json`. One import brings in the factory.

```ts
import { createEngine } from "@clockwyrks/simple-3d";
```

The clock catalogue, the touch layout catalogue, `cloneModel`, and every type
the engine names come from the same specifier.

```ts
import { cloneModel, createEngine, PacedClock, TOUCH_LAYOUTS } from "@clockwyrks/simple-3d";
import type { CueSpec, Engine, EngineOptions, Game } from "@clockwyrks/simple-3d";
```

## `three` is the build's own

`three` is a peer dependency of the engine, declared in the build's
`package.json` beside the engine itself. The engine re-exports nothing from it,
so a game imports `three` directly wherever it constructs a mesh, a material, a
light, or a color, and the engine, the build, and
`@clockwyrks/voxel-runtime/three` share the one instance the workspace
installed.

```ts
import * as THREE from "three";
```

The objects the engine hands a game, `api.scene` and `api.camera`, are that
same instance's `THREE.Scene` and `THREE.PerspectiveCamera` or
`THREE.OrthographicCamera`, so an `instanceof` check against the build's
import holds.

## Pick a logical design size

The width and height handed to `createEngine` are the coordinate system the
screen layer is drawn in, and they stay fixed for the life of the build. They
also fix the picture's aspect: the engine holds a perspective camera's `aspect`
at `width / height`, and the letterbox bars absorb whatever difference the
canvas element's own shape has. Choose a size that suits the game's aspect
ratio, state every HUD coordinate and size in those units, and state every
speed, size, and distance in the world in world units; the engine fits that
field onto whatever size the page gives the canvas.

A landscape game is comfortable at `1280 × 720` or `640 × 360`. The number
itself matters less than committing to one and writing every screen-layer
coordinate in it.

## Create it once

`createEngine` binds the game and builds the engine over the canvas. It runs
synchronously and runs no game code, so the engine exists before anything the
game does is observable. The scene and the camera exist from construction as
well. [`engine.initialize`](/engines/simple-3d/apis/engine/) then runs the
game's own `initialize` and resolves once the state is built, and `engine.run`
drives frames from there.

```ts
import { createEngine } from "@clockwyrks/simple-3d";
import { game } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing #game canvas");

const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
  game,
  background: "#101018",
});

await engine.initialize();
await engine.run();
```

That ordering is what lets a caller subscribe to engine events before the game
loads anything, so a failed asset is observed as it happens rather than inferred
afterwards.

```ts
engine.events.on("asset:failed", (event) => {
  console.error(`asset ${event.path} failed: ${event.reason}`);
});

const opening = await engine.initialize();
```

## The remaining options

| Option | Effect |
| --- | --- |
| `background` | A CSS color the whole canvas is cleared to before every frame, letterbox bars included. Left out, the canvas clears to transparency and the page shows through behind the game. |
| `layout` | Selects a touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers as actions. |
| `assetRoot` | The root every asset path resolves under. Defaults to `assets/`. |
| `surface` | Where the engine reads element size and device pixel ratio and attaches its listeners. Defaults to the canvas and its owning document. |
| `screen` | The canvas the screen layer draws on. Defaults to one created from the stage canvas's owning document. |
| `projection` | `"perspective"`, the default, or `"orthographic"`: which camera the engine creates and renders through. |
| `shadows` | `true` enables PCF soft shadow maps on the renderer. Defaults to `false`. |

```ts
const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
  game,
  layout: "dpad-4-two-buttons",
  assetRoot: "assets/",
});
```

`background` paints the bars as well as the picture. A game that wants a
different color inside the picture sets `scene.background` as well, which
paints inside the viewport alone, so the two together give a sky inside the
frame and a matching or contrasting border around it.

## The screen canvas

A build in the browser takes the default screen canvas: the engine obtains a
`webgl2` context from the stage canvas, builds its renderer over it, and creates
the screen layer's canvas from the stage canvas's owning document. Nothing in
the build names it.

Supplying `screen` is how a validator hands the engine a canvas it owns for the
screen layer, which is what lets it read the screen layer's pixels or substitute
a recording proxy for the context. The
[rendering](/engines/simple-3d/apis/rendering/) page specifies it.

## Choose a projection

`projection` selects the camera's class at construction, and the class holds
for the engine's life. The default is a perspective camera at `fov 60`, `near
0.1`, `far 1000`, at position `(0, 0, 10)` looking along `-Z` with `+Y` up,
which suits any game that shows depth: an orbit around a structure, a chase
view, a first-person walk.

```ts
const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
  game,
  projection: "orthographic",
});
```

An orthographic camera starts spanning `-width/2..width/2` by
`-height/2..height/2` at the same position and rotation, so at the defaults a
world unit on the `z = 0` plane is one logical unit, with the world origin at
the center of the design field and world `+Y` pointing up the screen. Choose it
for a board, an isometric field, or any picture whose size on screen should
stay fixed with distance. The extents are the game's to write from `render`,
and the [camera defaults](/engines/simple-3d/apis/view/) list both columns.

## Shadows

`shadows: true` turns the renderer's shadow maps on with PCF soft filtering.
Which lights cast and which objects cast and receive is the game's: `castShadow`
on a light and a mesh, `receiveShadow` on a mesh, as three reads them. The
[scene](/engines/simple-3d/usage/the-scene/) page shows a lit and shadowed
scene.

```ts
const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
  game,
  shadows: true,
});
```

Shadow maps cost a render of the scene per casting light, so a build enables
them when the picture calls for grounding and leaves them off otherwise.

## Size the canvas

The element's size is the page's business and the fit is the engine's. Give the
canvas a size in whatever CSS units the page wants, inline or through a
stylesheet, and leave the `width` and `height` attributes alone.

```html
<canvas id="game" style="width: 100vw; height: 100vh; display: block"></canvas>
```

The engine pins a fixed pixel size onto the canvas only while its reported size
still matches those attributes, which is what stops the backing store from
feeding back into the next measurement. A canvas the page has sized keeps
following its own rule, so it stays free to track the window. A canvas that
fills a sized wrapper takes the same form, with `width: 100%; height: 100%`.

The engine reads the laid-out size at the top of every frame and resizes the
backing store to match the device pixel ratio, and it syncs the screen layer's
canvas to the same backing store, so a window resize needs no handler and no
code in the game. The screen canvas the engine creates stays off the page; the
picture and the HUD reach the stage canvas together.

## Choose a clock

A [clock](/engines/simple-3d/apis/clocks/) decides what each frame's delta is,
and the engine holds exactly one. A build that omits the option gets a
`WallClock`, which reports the real time each frame took, clamped so a tab that
stops receiving frames resumes as though the game paused for the gap.

```ts
const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
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
to step a scenario reproducibly.

## Tearing down

A game that runs for the life of the page never needs to be torn down. Two
separate acts stop it when a build mounts the game into a view that goes away.

An `AbortSignal` passed to `run` halts the loop and leaves the engine usable, so
the same teardown path that cancels everything else cancels the loop with it.

```ts
const controller = new AbortController();
await engine.run({ signal: controller.signal });
```

`engine.destroy()` halts the loop, detaches every listener, and disposes the
renderer. It is idempotent, and it resolves any promise `run` returned. The
scene and the objects the game placed in it stay as they stand, so a caller
that reads the scene after destroying the engine still finds what the last
frame left.

```ts
engine.destroy();
```
