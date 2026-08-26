---
title: Rendering
---

A build draws through the engine-owned
[`SceneContext`](/engines/simple-3d/apis/game/), and the record of what it
issued is the [recording](/engines/simple-3d/apis/recording/). A check that is
about the picture arms the engine's recorder around the frames it cares about
and asserts over the capture: which operations were issued, with what
arguments, under what renderer state. An operation carries its arguments in
world units, so most claims read straight out of it, and
[`projectPoint`](/engines/simple-3d/apis/viewport/) maps a world point through
the frame's camera when a claim is about a position on screen.

Drawing happens inside a frame, so a check advances at least one frame with the
recorder armed before it reads anything. The engine clears the canvas at the
top of every frame and the game draws the complete picture, so every captured
frame stands alone.

## Capturing frames

Capture begins at the frame after `startRecording`, so arming, advancing, and
stopping yields exactly the frames the advance ran. A case writes the two
helpers once, beside its harness.

```ts
import type { DrawOp, Recording } from "@test-cabinet/simple-3d";
import type { Harness } from "./harness";

export async function capture(h: Harness, frames = 1): Promise<Recording> {
  h.engine.startRecording();
  await h.engine.advance(frames);
  return h.engine.stopRecording();
}

export function frameOps(recording: Recording, index: number): DrawOp[] {
  return recording.frames[index].ops.map((i) => recording.ops[i]);
}
```

A frame names its operations by index into the recording's shared `ops` table,
in issue order, and every operation a build issues is a method call on the
scene context, so each entry is `{ op: "call", method, args }`.

## Reading the operations

The arguments are the values the build supplied: a transform as its plain
shape, a color as its string, a handle as `{ $asset: n }` indexing the
recording's asset table, whose entry carries the path the handle was loaded
from. A claim about which mesh drew, and where, filters the calls and reads the
arguments.

```ts
import type { DrawOp, DrawValue, Transform } from "@test-cabinet/simple-3d";

const recording = await capture(h);
const ops = frameOps(recording, 0);

const assetPath = (arg: DrawValue): string =>
  recording.assets[(arg as { $asset: number }).$asset].path;

const ball = ops.find(
  (op): op is Extract<DrawOp, { op: "call" }> =>
    op.op === "call" &&
    op.method === "drawMesh" &&
    assetPath(op.args[0]) === "meshes/ball.glb",
);
expect(ball).toBeDefined();

const { position } = ball!.args[1] as unknown as Transform;
expect(position.x).toBeCloseTo(h.snapshot().ball.x, 5);
```

Numbers inside a recorded value are written to at most nine significant digits,
so a numeric claim compares with a tolerance rather than for equality; the
frame metadata (`count`, `timeMs`, `deltaMs`) is exact.

Reach for the operations when the claim is about what was drawn: a mesh drawn
from the right file, a transform that tracks the simulated position, a clip
posed at the accumulated time, a material that changed when it should, the
count of a repeated element, or the draws of two frames compared to show that
something moved.

## The renderer state

`recording.states[frame.state]` is the camera, lights, and mode in force when
the frame opened; a `setCamera`, `setLights`, or `setMode` the frame issued is
among its operations. The camera a frame's draws projected through is therefore
the last `setCamera` among its operations, or the inherited one when it issued
none, and one helper resolves it.

```ts
import type { CameraState, Recording } from "@test-cabinet/simple-3d";

export function frameCamera(recording: Recording, index: number): CameraState {
  const frame = recording.frames[index];
  let camera = recording.states[frame.state].camera;
  for (const i of frame.ops) {
    const op = recording.ops[i];
    if (op.op === "call" && op.method === "setCamera") {
      camera = op.args[0] as unknown as CameraState;
    }
  }
  return camera;
}
```

Presentation claims read the same surfaces: the mode is `"standard"`, the
light list is non-empty (an unlit black scene is the symptom of a build that
never called `setLights`), the camera sits behind the player the specification
puts it behind.

## From a world point to a pixel

`projectPoint` maps a world point through a camera and the
[viewport](/engines/simple-3d/apis/viewport/) into logical coordinates, and the
viewport equations `offsetX + x * scale` and `offsetY + y * scale` carry a
logical coordinate on to the device pixel it drew at. With the harness
reporting the logical design size at a device pixel ratio of `1`, the scale is
`1` and both offsets are `0`, so a projected coordinate is the device
coordinate.

```ts
import { projectPoint } from "@test-cabinet/simple-3d";

const camera = frameCamera(recording, 0);
const { ball } = h.snapshot();
const at = projectPoint(camera, h.engine.viewport(), {
  x: ball.x,
  y: ball.y,
  z: ball.z,
});

expect(at).not.toBeNull();
expect(at!.x).toBeGreaterThan(0);
expect(at!.x).toBeLessThan(FIELD_W);
```

A point at or behind the camera plane projects to `null`, and a point outside
the frustum lands outside `0..width` × `0..height` and is returned as-is, so
on-screen and off-screen are each one call. The camera is read from the
recording, so the projection a check computes is the projection the frame drew
with.

## HUD claims

Score, timers, and menus draw through `drawHudText` and `drawHudRect` in
logical design coordinates, and the string is an argument, so text is asserted
on directly.

```ts
const text = frameOps(recording, 0)
  .filter((op) => op.op === "call" && op.method === "drawHudText")
  .map((op) => String(op.args[0]));

expect(text).toContain("SOLO");
```

The face is the engine's own monospace face and the position and size are
arguments, so the call names everything the drawn text depends on.

## Pixel readback

The harness canvas yields a real WebGL2 context, and its `readPixels` returns
the framebuffer's bytes, rows bottom-up. The recording remains the documented
surface for a drawing claim: a lit pixel folds the material, the lights, the
depth resolution, and anti-aliasing into one color, so it is byte-exact against
nothing a specification states, where an operation's arguments are the
specification's own values. There is no substituting a fake context —
`RenderApi.scene` is the engine's own scene context, and the recorder built
into it is the capture route.

## Choosing the surface

`engine.state` answers claims about the simulation; the recording answers
claims about the drawing. A check states its claim in whichever surface the
specification stated it in, and `projectPoint` bridges the two when the claim
is about where on screen a simulated thing appears.
