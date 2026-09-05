---
title: Rendering
---

There are two ways to assert on what a build drew. Reading the canvas back
establishes what the picture is; recording the context establishes which
operations produced it. A suite may use both against the same run.

Drawing happens inside a frame, so a check advances at least one frame before it
reads anything. The pipeline clears the canvas and draws the complete picture
each frame, so what a read sees is the last frame alone.

## Pixel readback

The harness canvas is a `@napi-rs/canvas` canvas, and `getImageData` returns its
bytes. A sample is four bytes in `RGBA` order. A game states its positions in
world units, so the helper converts a world point through the camera and then
through the viewport.

```ts
import type { Vec2 } from "@clockwyrks/structured-2d";
import type { Harness } from "./harness";

export function sample(h: Harness, point: Vec2) {
  const view = h.engine.viewport();
  const logical = h.engine.world.camera.worldToLogical(point);
  const ctx = h.canvas.getContext("2d");
  const [r, g, b, a] = ctx.getImageData(
    Math.round(view.offsetX + logical.x * view.scale),
    Math.round(view.offsetY + logical.y * view.scale),
    1,
    1,
  ).data;
  return { r, g, b, a };
}
```

### The world-to-device mapping

There are three spaces. A transform is in world units, the camera projects world
units into the logical design size handed to `createEngine`, and the viewport
fits that logical size into the canvas's device pixels. The helper composes the
two maps in that order, which is the same composition the pipeline hands to the
context.

`camera.worldToLogical` performs the first stage, and its inverse is
`camera.logicalToWorld`. A world's camera starts at the center of the design
field with a zoom of `1`, so world coordinates and logical coordinates coincide
until the game moves the camera. Going through the camera anyway keeps a check
correct once a level follows a view target or clamps to `camera.bounds`. A
component in `screen` space skips the first stage: its composed transform is
already logical, so a check applies the second stage alone to it.

The second stage is `offsetX + x * scale` and `offsetY + y * scale`. `scale` is
device pixels per logical unit with the device pixel ratio already folded in,
and the two offsets are the letterbox bars. With the harness reporting the
logical design size at a device pixel ratio of `1`, the scale is `1` and both
offsets are `0`, so a logical coordinate is the device coordinate. Building the
harness at a ratio of `2` is how a check exercises the fit itself, and the
conversion above keeps every other check correct at both ratios.

### Sampling inside a shape

Take a sample at least two logical pixels inside the shape's edge. Curve edges
are anti-aliased, so a pixel on or near an edge blends the shape with what is
behind it, while an interior pixel carries the fill exactly.

An interior sample is byte-exact against the color the build was told to use, so
a fill is asserted on directly.

```ts
const paddle = world.byTag(TAGS.paddleP1)[0];
expect(sample(h, paddle.transform)).toEqual({ r: 0xf2, g: 0xf5, b: 0xf7, a: 255 });
```

Reach for pixels when the claim is about the picture: the background color, a
component's fill, whether something occupies a position on screen, whether the
letterbox bars are clear, whether an actor moved between two frames.

## Serving the produced tree

The [asset loader](/engines/structured-2d/apis/assets/) fetches every path
under the asset root through the host's `fetch`, decodes an image through
`createImageBitmap`, and decodes a sound through an `AudioContext`. Node has
none of the three, so a harness stands each up on `globalThis` before it
constructs an engine, once for the life of the process.

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Image, loadImage } from "@napi-rs/canvas";

const servedPaths = new Map<string, string>();
const bitmapPaths = new WeakMap<object, string>();
const digest = (bytes: Uint8Array): string =>
  createHash("sha1").update(bytes).digest("hex");

globalThis.fetch = async (input) => {
  const url = String(input);
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(WORKSPACE, url));
  } catch {
    return new Response(null, { status: 404, statusText: "Not Found" });
  }
  servedPaths.set(digest(bytes), url);
  return new Response(new Uint8Array(bytes));
};

globalThis.createImageBitmap = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const image = await loadImage(Buffer.from(bytes));
  const path = servedPaths.get(digest(bytes));
  if (path !== undefined) bitmapPaths.set(image, path);
  return image;
};

globalThis.ImageBitmap = Image;
```

The `fetch` reads a path carrying no scheme from the workspace, which is where
the build's asset root sits, and answers a missing file with a `404`, the shape
the loader reports as `asset:failed`. The bytes each served file returns are
digested and remembered against its path, and the image decoded from the same
bytes is keyed to that path, so the source of a `drawImage` call resolves to
the produced file it came from. A source the harness never served resolves to
nothing, which is the reading for a build that drew a canvas it painted itself.

The [recorder](/engines/structured-2d/concepts/recording/) decides what is a
bitmap by testing a source against the host's image classes, `ImageBitmap`
among them, and captures a match as an image entry rather than an opaque
marker. Setting that global to the canvas library's `Image` class, which is
what the `createImageBitmap` above returns, is what puts the produced sprites
into a recording. The engine and a build name `ImageBitmap` as a type alone, so
the game runs unchanged under it.

### Blits

A claim about a sprite is a claim about where its blit landed: how large it was
drawn, whether it was mirrored, and whether smoothing was off. The proxy below
reads the transform and `imageSmoothingEnabled` off the real context at each
`drawImage` before forwarding the call, because the context is the authority on
where any transform the build drew under put it. A blit is the destination
rectangle's four corners mapped through that transform and boxed in device
pixels; a negative determinant marks a horizontal mirror.

```ts
export interface Blit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  smoothing: boolean;
  mirrored: boolean;
}
```

A sprite is attributed to the object it was drawn on by the box's center, which
the case's asset spec fixes as the object's own position, so a check finds the
blits within a tolerance of a world point mapped through the camera and the
viewport and asks which produced file each came from.

## The recording proxy

The pipeline draws through the 2D context the canvas returns, so a suite
substitutes its own object by replacing `getContext` on the harness canvas
before it advances the frame it wants recorded. A `Proxy` over the real context
records each call and each property
assignment and forwards both, which keeps the pixels correct while the stream is
captured.

```ts
export interface DrawCall {
  method?: string;
  args?: unknown[];
  property?: string;
  value?: unknown;
}

export function recordDrawing(h: Harness): DrawCall[] {
  const calls: DrawCall[] = [];
  const real = h.canvas.getContext("2d");

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

  h.canvas.getContext = () => proxy;
  return calls;
}
```

The stream carries the arguments, so a claim about text, a font, a line width, a
transform, a draw order, or a count of draws is read straight out of it. A
`DrawComponent` receives the same context on `DrawApi.ctx`, so a build that
draws for itself is recorded alongside the built-in components.

```ts
const calls = recordDrawing(h);
await engine.advance(1);

const text = calls
  .filter((call) => call.method === "fillText")
  .map((call) => String(call.args?.[0]));

expect(text).toContain("SOLO");
```

The pipeline sorts its components by layer ascending, then by the owning actor's
spawn order, then by attachment order, and the sort is stable. A claim about the
order two things were drawn in is therefore a claim about a fixed sequence, and
a redraw with no change reproduces the previous stream.

## Asserting on a render mode

[`engine.renderer`](/engines/structured-2d/apis/rendering/) carries the mode and
the collision overlay. Both change what the pipeline draws rather than what a
tick computes, so a check sets one, advances a single frame, and reads the
canvas again with the world untouched.

```ts
await engine.advance(1);
const shaded = sample(h, target.transform);

engine.renderer.setMode("wireframe");
await engine.advance(1);
const wireframe = sample(h, target.transform);

expect(engine.renderer.mode()).toBe("wireframe");
expect(shaded).toEqual({ r: 0x7f, g: 0xd1, b: 0xff, a: 255 });
expect(wireframe).not.toEqual(shaded);
```

`shaded` draws the full picture and is the default. `wireframe` draws each
component's outline alone, so an interior sample loses its fill. `unlit` draws
fills and images at full opacity with every tint dropped, which is how a check
about a shape's identity avoids a build's opacity animation. `silhouette` fills
each component flat in its layer's color, which reduces the picture to its layer
structure.

`setCollisionOverlay` draws every enabled collider's shape over the finished
picture, in a color per response, and is independent of the mode. A check that
is about a collider compares a frame with the overlay on against the same frame
with it off.

## Choosing between them

Pixels answer "what does the player see at this point". The stream answers "what
did the build ask the context to do". A check states its claim in whichever of
those two the specification stated it in, and a claim about a color at a
position stays with pixels because a fill's arguments say nothing about where
the fill landed.
