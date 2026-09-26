---
title: Rendering
---

There are five ways to assert on what a build drew. Reading the scene
establishes what the build placed in the world and where; projecting through
the view establishes where a world point lands on the stage; reading the
screen layer's canvas back establishes what the HUD is; reading the stage
canvas back establishes what the rendered picture shows; recording the screen
layer's context establishes which operations produced the HUD. A suite may use
any of them against the same run.

Drawing happens inside a frame, so a check advances at least one frame before
it reads anything. `render` updates the scene from the state and poses the
camera, the engine reads the camera into the view after `render` returns, and
both canvases are cleared at the top of every frame and redrawn in full, so
what a read sees is the last frame alone.

## The scene

`engine.scene` is the live `THREE.Scene` the build populates, and after any
number of frames it holds what the build's `render` left there. A check finds
an object by the name the case fixed for it with `scene.getObjectByName`, or
walks the scene with `traverse` and picks objects by class, and reads what
three reports about each: its world position, its visibility, its geometry's
vertex count, its material's color.

```ts
import * as THREE from "three";

export function meshes(scene: THREE.Scene): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}
```

`three` is the build's own dependency, so the classes a suite tests against
with `instanceof` are the classes the build constructed. World matrices are
updated after every `render`, and `getWorldPosition` updates the object's own
before answering, so a position read after an `advance` is where the object
stood in the frame that ran.

```ts
await h.engine.advance(1);

const hook = h.engine.scene.getObjectByName("hook");
expect(hook).toBeDefined();

const at = hook!.getWorldPosition(new THREE.Vector3());
const { hook: state } = h.snapshot();
expect(at.x).toBeCloseTo(state.x, 3);
expect(at.y).toBeCloseTo(state.y, 3);
expect(at.z).toBeCloseTo(state.z, 3);
```

A scene assertion is byte-exact in the sense a pixel assertion is: a material's
color is the color the build was told to use, read back through the material's
own `color`, and an object is present or absent, visible or hidden, with no
antialiasing in the way.

```ts
import { HELD_COLOR } from "../src/constants";

const crates = meshes(h.engine.scene).filter((mesh) =>
  mesh.name.startsWith("crate-"),
);
expect(crates).toHaveLength(h.snapshot().crates.length);

const held = crates.find((mesh) => mesh.name === `crate-${h.snapshot().held}`);
const material = held!.material as THREE.MeshStandardMaterial;
expect(`#${material.color.getHexString()}`).toBe(HELD_COLOR);
expect(held!.visible).toBe(true);
expect(held!.geometry.getAttribute("position").count).toBeGreaterThan(0);
```

The camera is read the same way. `engine.camera` is the live camera the build
poses, and `engine.view().camera()` is a snapshot of it as it stood at the most
recent render, so a claim that the camera follows the hook or holds a fixed
height reads either.

```ts
const camera = h.engine.view().camera();
expect(camera.projection).toBe("perspective");
expect(camera.position.y).toBeGreaterThan(h.snapshot().hook.y);
```

Reach for the scene when the claim is about the world: that an object exists
for each thing the state carries, that it stands where the state says, that it
is colored or hidden as the specification requires, that a light is present,
that the camera is where the rules put it.

## Projection

`engine.view().project(point)` maps a world point through the camera as it
stood at the most recent render onto the logical stage, and reports whether
the point lies inside the camera's frustum. A claim about where something
appears on screen is checked through it without pixels, in the same logical
coordinates the screen layer draws in.

```ts
import { STAGE_H, STAGE_W } from "../src/constants";

const { hook } = h.snapshot();
const on = h.engine.view().project({ x: hook.x, y: hook.y, z: hook.z });

expect(on.visible).toBe(true);
expect(on.x).toBeGreaterThan(0);
expect(on.x).toBeLessThan(STAGE_W);
expect(on.y).toBeLessThan(STAGE_H / 2);
```

The view answers from the camera the frame rendered through, so a check
advances a frame after posing the scenario before
it projects. Reach for projection when the claim is about the stage rather
than the world: that the hook stays in view, that the camera keeps the truck
in the lower half of the screen, that a label the build anchors to a world
point is drawn at the point's projection.

## Pixel readback

The harness holds both canvases the engine draws on. The screen canvas holds
the screen layer, and the stage canvas holds the scene as the renderer drew it,
so a check reads whichever layer its claim is about. A sample is four bytes in
`RGBA` order.

### The screen layer

The screen canvas's 2D context answers `getImageData` with the layer's bytes.

```ts
export function sample(h: Harness, x: number, y: number) {
  const view = h.engine.viewport();
  const ctx = h.screen.getContext("2d")!;
  const [r, g, b, a] = ctx.getImageData(
    Math.round(view.offsetX + x * view.scale),
    Math.round(view.offsetY + y * view.scale),
    1,
    1,
  ).data;
  return { r, g, b, a };
}
```

The screen layer is transparent wherever the game drew nothing, since that is
where the scene shows through once the layer is composited, so a sample outside
every HUD element reads an alpha of `0`. A sample inside one reads the fill the
build drew there.

### The stage canvas

The stage canvas holds a `webgl2` context, so a check draws it into a 2D canvas
the suite owns and reads that canvas back with `getImageData`. The copy is the
picture as the frame left it: the scene the renderer drew with the screen layer
composited over it, so a sample under a HUD element is that element's fill and
a sample where the layer is transparent is what the renderer drew.

```ts
export function stageSample(h: Harness, x: number, y: number) {
  const view = h.engine.viewport();
  const copy = document.createElement("canvas");
  copy.width = h.stage.width;
  copy.height = h.stage.height;
  const ctx = copy.getContext("2d")!;
  ctx.drawImage(h.stage, 0, 0);
  const [r, g, b, a] = ctx.getImageData(
    Math.round(view.offsetX + x * view.scale),
    Math.round(view.offsetY + y * view.scale),
    1,
    1,
  ).data;
  return { r, g, b, a };
}
```

The canvas is cleared to `background` before every frame, letterbox bars
included, so a sample at a point where nothing was drawn reads the background
exactly, and a stage built with no `background` reads an alpha of `0` there. A
sample inside a lit object carries the material's color under the scene's
lighting, so a claim about it is stated as a dominance or a tolerance, with the
red channel above the others for a red hook, rather than as bytes. The point
sampled for the background is one the specification leaves empty, such as the
sky above the rail.

```ts
expect(stageSample(h, 4, 4)).toEqual({ r: 0x10, g: 0x10, b: 0x18, a: 255 });

const { hook } = h.snapshot();
const on = h.engine.view().project({ x: hook.x, y: hook.y, z: hook.z });
const at = stageSample(h, on.x, on.y);
expect(at.r).toBeGreaterThan(at.g);
expect(at.r).toBeGreaterThan(at.b);
```

Reach for the stage canvas when the claim is about the rendered picture: that
the bars carry the background, that an object's color shows where its
projection lands, that a hidden object left nothing behind, that a fog or a
post-effect changed the picture at all.

### The logical-to-device mapping

A game draws on the screen layer in logical units and the canvas holds device
pixels, so a sample converts through the
[viewport](/engines/simple-3d/concepts/viewport/): `offsetX + x * scale` and
`offsetY + y * scale`. `scale` is device pixels per logical unit with the
device pixel ratio already folded in, and the two offsets are the letterbox
bars.

With the harness reporting the logical design size at a device pixel ratio of
`1`, the scale is `1` and both offsets are `0`, so a logical coordinate is the
device coordinate. Building the harness at a ratio of `2` is how a check
exercises the mapping itself, and the conversion above keeps every other check
correct at both ratios. Both canvases share one viewport, so the same mapping
serves a sample of either.

### Sampling inside a shape

Take a sample at least two logical pixels inside the shape's edge. Curve edges
are anti-aliased, so a pixel on or near an edge blends the shape with what is
behind it, while an interior pixel carries the fill exactly.

An interior sample is byte-exact against the color the build was told to use,
so a fill is asserted on directly.

```ts
import { PANEL } from "../src/constants";

expect(sample(h, PANEL.x + 4, PANEL.y + 4)).toEqual({
  r: 0x1b,
  g: 0x24,
  b: 0x30,
  a: 255,
});
expect(sample(h, STAGE_W / 2, STAGE_H / 2).a).toBe(0);
```

Reach for pixels when the claim is about the HUD as a picture: a panel's fill,
whether a readout occupies a position on screen, whether the letterbox bars are
clear, whether the layer is empty where the specification says the scene shows
through.

## The recording proxy

`RenderApi.screen` is whatever the screen canvas returned from `getContext`, so
a suite substitutes its own object by overriding `getContext` on the screen
canvas before the engine is created. A `Proxy` over the real context records
each call and each property assignment and forwards both, which keeps the
pixels correct while the stream is captured.

```ts
import { STAGE_H, STAGE_W } from "../src/constants";
import { pageCanvas } from "./harness";

export interface DrawCall {
  method?: string;
  args?: unknown[];
  property?: string;
  value?: unknown;
}

export function recordingScreen(): {
  screen: HTMLCanvasElement;
  calls: DrawCall[];
} {
  const calls: DrawCall[] = [];
  const screen = pageCanvas(STAGE_W, STAGE_H);
  const real = screen.getContext("2d")!;

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
  return { screen, calls };
}
```

The harness takes the screen canvas as its third argument, which is what lets a
check hand it the proxied one before `createEngine` runs. The stream carries
the arguments, so a claim about text, a font, a line width, a transform, a draw
order, or a count of draws is read straight out of it.

```ts
const { screen, calls } = recordingScreen();
const h = createHarness(new ConstantClock(1000 / 60), 1, screen);
await h.engine.initialize();
await h.engine.advance(1);

const text = calls
  .filter((call) => call.method === "fillText")
  .map((call) => String(call.args?.[0]));

expect(text).toContain("PRACTICE");
```

Reach for the stream when the claim is about the operation rather than the
result: a string that was drawn, a shape that was stroked rather than filled,
an image that was drawn from the sprite sheet, the order two HUD layers were
drawn in. Text is the clearest case, since the string is an argument and the
pixels it produced depend on the font the machine resolved.

## Choosing between them

The scene answers "what is in the world and where". Projection answers "where
does that land on the stage". The screen layer's pixels answer "what does the
player see at this point of the HUD", and the stage canvas's answer "what did
the renderer draw at this point". The stream answers "what did the build ask
the screen context to do". A check states its claim in whichever of those the
specification stated it in: a claim about an object's position or color stays
with the scene, a claim about a HUD color at a position stays with pixels
because a fill's arguments say nothing about where the fill landed, a claim
about where a world point appears stays with projection because the scene
alone says nothing about the camera between it and the stage, and a claim
about the picture itself stays with the stage canvas.

What the engine drew across a stretch of frames, as one video, is the
[recording](/engines/simple-3d/validators/recording/), which the reviewer
looks at beside the verdict the checks decided.
