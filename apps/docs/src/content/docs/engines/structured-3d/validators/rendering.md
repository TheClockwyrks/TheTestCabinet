---
title: Rendering
---

There are two ways to assert on what a build drew. The engine's recorder
establishes which operations produced the picture; reading the canvas back
establishes what the picture is. A suite may use both against the same run.

Drawing happens inside a frame, so a check advances at least one frame before it
reads anything. The pipeline clears the canvas and draws the complete picture
each frame, so what a read sees is the last frame alone.

## The recorded frame

The pipeline draws through the scene context the engine owns, and the
[recorder](/engines/structured-3d/apis/recording/) captures everything drawn
through it. The scene context is not an object a suite can substitute, so the
recorder is the route to the draw calls: arm it, advance the frame the check is
about, and read the document back.

```ts
const { engine } = createHarness();
await engine.initialize();

engine.startRecording();
await engine.advance(1);
const recording = engine.stopRecording();

const [frame] = recording.frames;
const ops = frame.ops.map((i) => recording.ops[i]);
```

A frame names the operations it issued by index into `recording.ops`, in issue
order, and the renderer state it inherited by index into `recording.states`. The
state carries the camera, the lights, and the render mode in force when the
frame opened, so a claim about how a frame was framed or lit is read off plain
data rather than pixels.

```ts
const state = recording.states[frame.state];

expect(state.mode).toBe("standard");
expect(state.camera.fovY).toBeCloseTo(Math.PI / 3, 6);
expect(state.lights.map((light) => light.type)).toContain("directional");
```

The operations carry their arguments as plain data: a `Vec3` as `{ x, y, z }`, a
`Transform` field by field, a loaded asset as `{ $asset: n }` indexing
`recording.assets`, whose entries carry the path the handle was loaded from. The
built-in render components, the collision overlay, and a `DrawComponent`'s own
calls all draw through the scene context, so the stream is the whole picture,
and a `MeshComponent`'s draw reaches it as the scene context's mesh call
carrying the handle and the component's world transform.

```ts
import type { DrawOp } from "@test-cabinet/structured-3d";

const meshes = ops
  .filter((op): op is Extract<DrawOp, { op: "call" }> => op.op === "call")
  .filter((op) => op.method === "drawMesh")
  .map((op) => (op.args[0] as { $asset: number }).$asset)
  .map((index) => recording.assets[index].path);

expect(meshes).toContain("models/ship.glb");
```

The pipeline sorts its components by layer ascending, then by the owning actor's
spawn order, then by attachment order, and the sort is stable. Opaque draws
resolve by the depth buffer, so their issue order does not change the picture,
but the stream carries that fixed sequence all the same, and a redraw with no
change reproduces the previous stream.

## Pixel readback

The harness canvas yields the WebGL2 context the engine renders through, and
`readPixels` returns its bytes. A sample is four bytes in `RGBA` order. A game
states its positions in world units, so the helper converts a world point
through the camera and then through the viewport.

```ts
import type { Vec3 } from "@test-cabinet/structured-3d";
import type { Harness } from "./harness";

export function sample(h: Harness, point: Vec3) {
  const view = h.engine.viewport();
  const logical = h.engine.world.camera.project(point);
  if (logical === null) throw new Error("point is behind the camera");

  const x = Math.round(view.offsetX + logical.x * view.scale);
  const y = Math.round(view.offsetY + logical.y * view.scale);
  const gl = h.canvas.getContext("webgl2");
  const data = new Uint8Array(4);
  gl.readPixels(x, h.canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);

  const [r, g, b, a] = data;
  return { r, g, b, a };
}
```

`readPixels` addresses rows from the bottom of the canvas, so the helper flips
the device y against the canvas height. Everything before that line is the same
two-stage conversion every screen-space claim states.

### The world-to-device mapping

There are three spaces. A transform is in world units, the camera's frustum
projects world units into the logical design size handed to `createEngine`, and
the viewport fits that logical size into the canvas's device pixels. The helper
composes the two maps in that order, which is the same composition the renderer
performs.

[`camera.project`](/engines/structured-3d/apis/camera/) performs the first
stage: `projectPoint` over the camera's snapshot and the current viewport,
returning logical coordinates, or `null` for a point at or behind the camera
plane. The frustum's aspect is always the design aspect, so the picture is
identical on every canvas and a projected coordinate does not depend on the
machine the suite ran on. Going through the camera keeps a check correct once a
level follows a view target, because the projection a check uses is the one the
world's camera holds that frame.

The second stage is `offsetX + x * scale` and `offsetY + y * scale`. `scale` is
device pixels per logical unit with the device pixel ratio already folded in,
and the two offsets are the letterbox bars. With the harness reporting the
logical design size at a device pixel ratio of `1`, the scale is `1` and both
offsets are `0`, so a logical coordinate is the device coordinate. Building the
harness at a ratio of `2` is how a check exercises the fit itself, and the
conversion above keeps every other check correct at both ratios.

### Sampling a surface

Sample a point on a surface that faces the camera, at least two logical pixels
inside its edge on screen. Edges are anti-aliased, so a pixel on or near one
blends the surface with what is behind it, while an interior pixel carries the
surface's color exactly.

Under `standard` the sampled color carries the lighting: the base color
multiplied by what the lights deliver at that point. A claim about a surface's
identity therefore samples under `unlit`, where an untextured surface draws its
base color byte-exact; a claim about the lighting itself stays under `standard`
and compares two samples — the same point under two light setups, or two points
on differently lit faces — rather than asserting absolute bytes.

```ts
engine.renderer.setMode("unlit");
await engine.advance(1);

const paddle = world.byTag(TAGS.paddleP1)[0];
expect(sample(h, paddle.transform.position)).toEqual({ r: 0xf2, g: 0xf5, b: 0xf7, a: 255 });
```

Reach for pixels when the claim is about the picture: the background color,
whether something occupies a position on screen, whether the letterbox bars are
clear, whether an actor moved between two frames.

## Asserting on a render mode

[`engine.renderer`](/engines/structured-3d/apis/rendering/) carries the mode and
the collision overlay. Both change what the pipeline draws rather than what a
tick computes, so a check sets one, advances a single frame, and reads the
canvas again with the world untouched.

```ts
await engine.advance(1);
const standard = sample(h, target.transform.position);

engine.renderer.setMode("wireframe");
await engine.advance(1);
const wireframe = sample(h, target.transform.position);

expect(engine.renderer.mode()).toBe("wireframe");
expect(wireframe).not.toEqual(standard);
```

`standard` draws the full picture and is the default. `wireframe` draws each
component's geometry as its triangle edges alone, so an interior sample loses
its surface. `unlit` draws base colors and textures at full brightness with
lighting and every tint dropped, which is how a check about a surface's identity
avoids the lighting and a build's opacity animation. `normals` colors each pixel
by its world-space surface normal, mapped as `rgb = (n + 1) / 2`, which turns a
sample into a claim about a surface's orientation.

`setCollisionOverlay` draws every enabled collider's shape as wireframe outlines
over the finished picture, in a color per response and after a depth clear so
nothing the game drew hides it, and is independent of the mode. A check that
is about a collider compares a frame with the overlay on against the same
frame with it off.

## Choosing between them

Pixels answer "what does the player see at this point". The recording answers
"what did the pipeline draw, and under what camera, lights, and mode". A check
states its claim in whichever of those two the specification stated it in, and a
claim about a color at a position stays with pixels because a draw call's
arguments say nothing about which pixels its surfaces landed on.
