---
title: Drawing
---

Everything a game draws goes inside `render(state, api)` and reaches the canvas
through `api.scene`, the engine-owned
[scene context](/engines/simple-3d/apis/game/). The scene arrives cleared and
the world is the game's own: right-handed, +Y up, in whatever units the game
decided. The camera set through the scene context projects that world into the
logical design field, and the engine letterboxes the field onto the element,
whatever size the canvas happens to be.

```ts
import { quatFromAxisAngle } from "@test-cabinet/simple-3d";
import type {
  CameraState,
  Game,
  LightState,
  Quat,
  Transform,
  Vec3,
} from "@test-cabinet/simple-3d";

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };
const at = (position: Vec3): Transform => ({
  position,
  rotation: IDENTITY,
  scale: ONE,
});

const CAMERA: CameraState = {
  position: { x: 0, y: 4, z: 12 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.3),
  fovY: Math.PI / 3,
  near: 0.1,
  far: 1000,
};

const LIGHTS: readonly LightState[] = [
  { type: "ambient", color: "#404050", intensity: 0.5 },
  {
    type: "directional",
    color: "#ffffff",
    intensity: 1,
    direction: { x: -1, y: -2, z: -1 },
  },
];

interface State {
  readonly ball: { readonly y: number; readonly vy: number };
}

const game: Game<State, null> = {
  initialize() {
    return [{ ball: { y: 4, vy: 0 } }, null];
  },
  update(state, api, dt) {
    const vy = state.ball.vy - 20 * dt;
    const y = state.ball.y + vy * dt;
    if (y <= 1 && vy < 0) return { ball: { y: 1, vy: -vy } };
    return { ball: { y, vy } };
  },
  render(state, api) {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    scene.drawGeometry(scene.createPlane(20, 20), "#1b1b2a", at({ x: 0, y: 0, z: 0 }));
    scene.drawGeometry(
      scene.createSphere(1),
      "#7fd1ff",
      at({ x: 0, y: state.ball.y, z: 0 }),
    );
  },
};
```

Each draw call names its full world transform, so a helper like `at` above is
the whole of a build's placement machinery. What the drawing looks like on
screen follows from the camera: `api.viewport()` reports the design size the
engine was created with together with the fit that size currently sits under,
and the [viewport page](/engines/simple-3d/apis/viewport/) states the mapping
from world through logical to device pixels.

## Set the camera and lights first

The camera, the light list, and the render mode are the scene context's
retained state: each holds from the frame it is set until set again. The
default light list is empty, and under it the standard mode lights nothing, so
a scene with no `setLights` call renders its meshes black. Set the lights and
the camera before the first draw — an ambient plus a directional light is the
standard opening pair — and keep the camera in the state so the value `render`
applies is the one the rest of the game reasons with.

Re-applying both at the top of every `render` is the idiomatic shape: it costs
nothing, and the picture stays a function of the state alone.

## Render only draws

`render` receives the state as a `DeepReadonly` view and returns nothing, so
the picture is a function of the state `update` returned and the compiler
refuses a render that assigns into it. A value the drawing depends on, such as
an animation phase or a highlighted entity, is computed in `update` and carried
in the state.

`RenderApi` carries the scene context, the frame counter, and the viewport.
Input and audio are absent from it, so a frame's response to the player is
decided entirely by `update`.

## Every frame draws the whole picture

The engine clears the canvas before each frame, so `render` starts from a blank
field and issues every draw that should be visible. Every frame is a complete
picture, which leaves a build free of scene-graph bookkeeping and makes a
single frame enough to describe what the game looked like at that instant.

Issue order is not paint order. Opaque draws resolve by the depth buffer, so a
build issues them in whatever order its code reads best. Translucent draws — a
material with `opacity` below `1`, every billboard, a line over a translucent
color — render after every opaque draw, sorted farthest-first from the camera.
HUD draws composite last, above the 3D picture, in issue order.

```ts
import type { RenderApi } from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

function render(state: DeepReadonly<Arena>, api: RenderApi): void {
  const { scene } = api;
  scene.setCamera(state.camera);
  scene.setLights(LIGHTS);

  drawFloor(scene);
  for (const rock of state.rocks) scene.drawMesh(ROCK, rock.transform);
  scene.drawMesh(SHIP, state.ship.transform);
  drawScore(scene, state.score);
}
```

## Geometry and materials are cheap

Procedural geometry and code-built materials come from the scene context's five
producers: `createBox`, `createSphere`, `createCylinder`, `createPlane`, and
`createMaterial`. A produced value is immutable and creation is deterministic,
so creating per frame inside `render` is the idiomatic pattern — two calls with
the same arguments share one entry in a
[recording](/engines/simple-3d/apis/recording/) — and keeping the value in
module scope is equally fine. `initialize` receives no scene context, so there
is no third place to create them.

```ts
function drawFloor(scene: SceneContext): void {
  const floor = scene.createPlane(40, 40);
  const grass = scene.createMaterial({ baseColor: "#2f5d34", roughness: 1 });
  scene.drawGeometry(floor, grass, at({ x: 0, y: 0, z: 0 }));
}
```

A `Color` string stands in for a whole material where the defaults suit, and a
[`MaterialHandle`](/engines/simple-3d/apis/assets/) loaded from a produced
material document slots into the same argument.

## The HUD

Score, timers, and menus draw through `drawHudText` and `drawHudRect`, in
logical design coordinates with `(0, 0)` at the top-left of the field. HUD
drawing composites above the 3D picture, so it needs no camera arithmetic and
sits at the same place on screen whatever the camera does. Text sizes are
logical units like every other HUD measurement, the face is the engine's own
monospace face, and `align` chooses which anchor the position names.

```ts
function drawScore(scene: SceneContext, score: number): void {
  scene.drawHudRect({ x: 260, y: 16 }, { x: 120, y: 32 }, "#00000080");
  scene.drawHudText(`SCORE ${score}`, { x: 320, y: 20 }, {
    size: 24,
    color: "#ffffff",
    align: "center",
  });
}
```

A label that should sit over a world object projects that object's position
into the field with [`projectPoint`](/engines/simple-3d/apis/viewport/) and
hands the result to `drawHudText`; a point behind the camera projects to
`null`, which is the cue to skip the label. Debug text belongs on the
[overlay](/engines/simple-3d/usage/diagnostics/) instead, which the engine
draws over the finished picture and a reviewer toggles on demand.

## Reading the pointer

The pointer is 2D: the engine maps each event into logical design coordinates
before the game sees it, so `update` reads positions on the axes the HUD draws
on, through [`UpdateApi.input`](/engines/simple-3d/apis/input/). Carrying a
pointer position into the world is the game's own arithmetic, and
`pointerRay` is the convention: it turns the camera and a logical point into a
world-space ray, which the game intersects with whatever its design picks
against.

```ts
import { pointerRay, vec3Add, vec3Scale } from "@test-cabinet/simple-3d";

update(state, api, dt) {
  const pointer = api.input.pointer();
  if (!pointer.down) return step(state, dt);

  const ray = pointerRay(state.camera, api.viewport(), {
    x: pointer.x,
    y: pointer.y,
  });
  const t = -ray.origin.y / ray.direction.y;   // where the ray meets y = 0
  if (t <= 0) return step(state, dt);

  const aim = vec3Add(ray.origin, vec3Scale(ray.direction, t));
  return step({ ...state, aim }, dt);
}
```

A ground plane, as above, is one division; a sphere or a `Box3` test over
`mesh.bounds` covers most picking a game needs. A point inside a letterbox bar
maps outside `0..width` or `0..height` and still yields a ray, so a game either
clamps it or treats it as a miss. A game that reacts to the path the pointer
traveled reads `api.input.pointerSamples()` and resolves each sample on its
own; the snapshot above is where the sweep ended, which is all aiming needs.

The pointer suits aiming and direct manipulation, where the position itself is
the input. Everything else a case checks belongs behind a registered
[action](/engines/simple-3d/usage/actions/), which a validator drives by name.
