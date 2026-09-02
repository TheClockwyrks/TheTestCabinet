---
title: Rendering
---

There are four ways to assert on what a build drew. Reading a render component
establishes what the build declared; reading the scene establishes what the
pipeline placed for it; projecting through the camera establishes where it
appears on the logical stage; and the screen layer's pixels and its operation
stream establish the HUD the player sees. A suite may use all of them against
the same run, and a claim about what was submitted to be drawn reads the
[recording](/engines/structured-3d/validators/recording/).

Drawing happens inside a frame, so a check advances at least one frame before it
reads anything. The pipeline syncs every world-space component's object, clears
the screen layer, and draws the complete screen pass each frame, so what a read
sees is the last frame alone. The `headless` backend produces no pixels of the
3D picture, so a claim about the rendered pixels of the world pass is a browser
check outside the in-process suite.

## Render components as data

A render component is a plain object on an actor, and its fields are the
declaration the pipeline draws from. A check reaches one through
`actor.component(MeshComponent)` or `actor.componentsOf(LightComponent)` and
reads its geometry, its material, its `visible`, and its `opacity` directly.

```ts
import { LightComponent, MeshComponent } from "@test-cabinet/structured-3d";
import { COLORS, TAGS } from "../../src/constants";

const ball = world.byTag(TAGS.ball)[0];
const mesh = ball.component(MeshComponent);

expect(mesh).not.toBeNull();
expect(mesh?.geometry.kind).toBe("sphere");
expect(mesh?.material.color).toBe(COLORS.ball);
expect(mesh?.visible).toBe(true);

const lights = world.actors().flatMap((actor) => actor.componentsOf(LightComponent));
expect(lights.some((light) => light.light.kind === "directional")).toBe(true);
```

Reach for the components when the claim is about what the build declared: the
shape an actor was given, the color the case fixed for it, whether it is hidden,
whether a level lights itself. A declaration says nothing about where the
pipeline put it, which is what the scene answers.

## The scene

[`engine.scene`](/engines/structured-3d/apis/engine/) is the `THREE.Scene` the
pipeline maintains: one three object per enabled, visible world-space
component, placed at the component's world transform every frame, with world
matrices updated under `headless` exactly as under `webgl`. A check finds an
object by name, where the game's own `Object3DComponent` subtree or a loaded
model's nodes carry names, or by traversal, and reads its world position, its
visibility, its geometry, and its material.

```ts
import * as THREE from "three";
import type { Vec3 } from "@test-cabinet/structured-3d";

export function meshesAt(
  scene: THREE.Scene,
  point: Vec3,
  tolerance = 1e-3,
): THREE.Mesh[] {
  const target = new THREE.Vector3(point.x, point.y, point.z);
  const position = new THREE.Vector3();
  const found: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.getWorldPosition(position).distanceTo(target) <= tolerance) {
      found.push(object);
    }
  });
  return found;
}
```

The helper finds the meshes the pipeline placed at an actor's position, which
is how a check ties a scene object back to the actor whose component produced
it without the pipeline naming anything. What it reads off the mesh is three's
own data: the material's color, the geometry's vertex count, and the object's
visibility.

```ts
await engine.advance(1);
const ball = world.byTag(TAGS.ball)[0];
const [mesh] = meshesAt(engine.scene, ball.transform.position);

expect(mesh).toBeDefined();
expect(mesh.visible).toBe(true);
expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(0);
expect(`#${(mesh.material as THREE.MeshStandardMaterial).color.getHexString()}`).toBe(COLORS.ball);

ball.destroy();
await engine.advance(1);
expect(meshesAt(engine.scene, ball.transform.position)).toHaveLength(0);
```

The scene reflects the frame most recently synced, so a pose is followed by one
`advance` before the scene is read, and a destroyed actor's object is gone after
the frame that removed it. A `ModelComponent`'s clone is a group whose nodes
carry the names `model.nodes` lists, so `engine.scene.getObjectByName` finds a
joint the voxel exporter named, and a game's `Object3DComponent` subtree is
found under whatever names the game gave its objects.

Reach for the scene when the claim is about what the pipeline did with a
declaration: that an object exists for a component, that it sits where the
actor's transform and the component's offset put it, that hiding the component
removed it, that a model's joint is posed.

## Projection

[`world.camera.worldToLogical`](/engines/structured-3d/apis/camera/) takes a
world point through the camera as it stands and returns the logical stage point
it draws at, its normalized depth, and whether it lies inside the frustum. A
claim about where something appears on screen is stated against that point,
with no pixels involved.

```ts
const ball = world.byTag(TAGS.ball)[0];
engine.debug.setBallPosition(0, 0, 0);
await engine.advance(1);

const projected = world.camera.worldToLogical(ball.transform.position);
expect(projected.visible).toBe(true);
expect(projected.x).toBeCloseTo(FIELD_W / 2, 3);
expect(projected.y).toBeCloseTo(FIELD_H / 2, 3);
```

A world's camera starts at `(0, 0, 10)` looking along `-Z`, so the origin
projects to the center of the design field until the game moves the camera.
Going through the camera keeps a check correct once a level follows a view
target or clamps to `camera.bounds`, and the `advance` before the read is what
lets the follow and the clamp run. `world.camera.snapshot()` is the pose itself,
as a value the check owns, and `camera.logicalToRay` is the inverse a pointer
check states its pick along.

### The world-to-device mapping

There are three spaces. A transform is in world units, the camera projects world
units into the logical design size handed to `createEngine`, and the viewport
fits that logical size into the canvas's device pixels. A pixel check composes
the two maps in that order, which is the same composition the pipeline draws
under.

A component in `screen` space skips the first stage: its composed transform is
already logical, `position.x` and `position.y` from the top-left of the design
field, so a check applies the second stage alone to it. The second stage is
`offsetX + x * scale` and `offsetY + y * scale`. `scale` is device pixels per
logical unit with the device pixel ratio already folded in, and the two offsets
are the letterbox bars. With the harness reporting the logical design size at a
device pixel ratio of `1`, the scale is `1` and both offsets are `0`, so a
logical coordinate is the device coordinate. Building the harness at a ratio of
`2` is how a check exercises the fit itself, and the conversion keeps every
other check correct at both ratios.

## Pixel readback

The harness's screen canvas is a `@napi-rs/canvas` canvas holding the screen
layer, and `getImageData` returns its bytes. A sample is four bytes in `RGBA`
order. The helper takes a logical point and converts it through the viewport
alone, because everything on the screen layer is drawn in logical units.

```ts
import type { Vec2 } from "@test-cabinet/structured-3d";
import type { Harness } from "./harness";

export function sample(h: Harness, point: Vec2) {
  const view = h.engine.viewport();
  const ctx = h.screen.getContext("2d");
  const [r, g, b, a] = ctx.getImageData(
    Math.round(view.offsetX + point.x * view.scale),
    Math.round(view.offsetY + point.y * view.scale),
    1,
    1,
  ).data;
  return { r, g, b, a };
}
```

The screen layer is cleared to transparency at the top of every screen pass and
the 3D picture lies beneath it on the stage canvas, so a sample where nothing
screen-space drew reports `a: 0`. That is how a check tells the HUD from the
world: a readout, a menu, or a label a `DrawComponent` pinned to an actor
carries alpha, and the picture behind it carries none here.

### Sampling inside a shape

Take a sample at least two logical pixels inside the shape's edge. Curve edges
are anti-aliased, so a pixel on or near an edge blends the shape with what is
behind it, while an interior pixel carries the fill exactly.

An interior sample is byte-exact against the color the build was told to use, so
a fill is asserted on directly. A `screen` component's composed transform is its
logical position, and a label a `DrawComponent` draws for a world point sits at
the point `worldToLogical` reports for it.

```ts
const marker = world.byTag(TAGS.scoreP1)[0];
const at = { x: marker.transform.position.x, y: marker.transform.position.y };
expect(sample(h, at)).toEqual({ r: 0xf2, g: 0xf5, b: 0xf7, a: 255 });

const label = world.camera.worldToLogical(ball.transform.position);
expect(sample(h, { x: label.x, y: label.y - 12 }).a).toBe(255);
```

Reach for pixels when the claim is about the HUD as the player sees it: a
readout's fill, whether a menu occupies a position on screen, whether the
letterbox bars are clear, whether a label followed its actor between two frames.

## The recording proxy

The pipeline draws the screen pass through the 2D context the screen canvas
returns, and the engine obtains that context at construction, so a suite
substitutes its own object by replacing `getContext` on the screen canvas
before the engine is created. The harness's `prepare` hook runs on the screen
canvas at that moment. A `Proxy` over the real context records each call and
each property assignment and forwards both, which keeps the pixels correct while
the stream is captured.

```ts
import type { Canvas } from "@napi-rs/canvas";

export interface DrawCall {
  method?: string;
  args?: unknown[];
  property?: string;
  value?: unknown;
}

export function recordDrawing(): {
  calls: DrawCall[];
  install: (screen: Canvas) => void;
} {
  const calls: DrawCall[] = [];

  const install = (screen: Canvas): void => {
    const real = screen.getContext("2d");
    const proxy = new Proxy(real, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return value.apply(target, args);
        };
      },
      set(target, prop, value) {
        calls.push({ property: String(prop), value });
        return Reflect.set(target, prop, value);
      },
    });
    screen.getContext = () => proxy;
  };

  return { calls, install };
}
```

The stream carries the arguments, so a claim about text, a font, a line width, a
transform, a draw order, or a count of draws is read straight out of it. A
`DrawComponent` receives the same context on `DrawApi.ctx`, so a build that
draws for itself is recorded alongside the built-in screen-space components.
The stream accumulates from construction on, so a check that is about one frame
empties it before advancing that frame.

```ts
const drawing = recordDrawing();
const h = createHarness(new ConstantClock(1000 / 60), 1, drawing.install);
await h.engine.initialize();

drawing.calls.length = 0;
await h.engine.advance(1);

const text = drawing.calls
  .filter((call) => call.method === "fillText")
  .map((call) => String(call.args?.[0]));

expect(text).toContain("SOLO");
```

The pipeline sorts its screen-space components by layer ascending, then by the
owning actor's spawn order, then by attachment order, and the sort is stable. A
claim about the order two things were drawn in is therefore a claim about a
fixed sequence, and a redraw with no change reproduces the previous stream. The
world pass draws nothing through this context, so the stream is the screen
layer alone.

## Asserting on a render mode

[`engine.renderer`](/engines/structured-3d/apis/rendering/) carries the mode and
the collision overlay. Both change what the pipeline draws rather than what a
tick computes, so a check sets one, advances a single frame, and reads again
with the world untouched. The world pass under a mode is observable in the
recording, because the scene is captured under the mode in force and carries
the materials the mode substituted; the screen pass under a mode is observable
in the screen layer's pixels.

```ts
function frameMaterials(recording: Recording) {
  const { document } = recording;
  const frame = document.frames[0];
  return frame.draws.map((i) => document.materials[document.draws[i].material]);
}

engine.renderer.setMode("wireframe");
engine.startRecording();
await engine.advance(1);
const wireframe = frameMaterials(engine.stopRecording());

expect(engine.renderer.mode()).toBe("wireframe");
expect(wireframe.length).toBeGreaterThan(0);
expect(wireframe.every((material) => material.wireframe)).toBe(true);

engine.renderer.setMode("unlit");
engine.startRecording();
await engine.advance(1);
const unlit = frameMaterials(engine.stopRecording());

expect(unlit.every((material) => material.kind === "basic")).toBe(true);
```

`shaded` draws every material as declared and is the default. `wireframe`
draws each mesh as its edges, so every recorded material carries `wireframe`,
and the screen pass draws each component's outline alone, so an interior
sample of a screen-space shape loses its fill. `unlit` draws every material's
base color and map at full opacity, which records as `basic`, and the screen
pass drops every tint, which is how a check about a shape's identity avoids a
build's opacity animation. `normals` colors every surface by its world-space
normal through a material outside the recorded kinds, which records as `opaque`
naming its constructor.

`setCollisionOverlay` draws every enabled collider's shape as a wireframe in the
world pass, after the scene, and is independent of the mode. A recording taken
with the overlay on carries each collider's shape among the frame's draws, so a
check that is about a collider compares the draw count of a frame with the
overlay on against the same frame with it off.

```ts
engine.startRecording();
await engine.advance(1);
const plain = engine.stopRecording().document.frames[0].draws.length;

engine.renderer.setCollisionOverlay(true);
engine.startRecording();
await engine.advance(1);
const overlaid = engine.stopRecording().document.frames[0].draws.length;

const enabled = world
  .actors()
  .flatMap((actor) => actor.componentsOf(ColliderComponent))
  .filter((collider) => collider.enabled);

expect(engine.renderer.collisionOverlay()).toBe(true);
expect(overlaid).toBe(plain + enabled.length);
```

## Choosing between them

A component answers "what did the build declare". The scene answers "what did
the pipeline place for it". Projection answers "where does it appear on the
stage". Pixels answer "what does the player see on the HUD at this point", and
the stream answers "what did the build ask the context to do". A check states
its claim in whichever of those the specification stated it in, and a claim
about a color at a position stays with pixels because a fill's arguments say
nothing about where the fill landed.
