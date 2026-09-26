---
title: Rendering
---

There are two ways to assert on what a build drew. Reading the canvas back
establishes what the picture is; recording the context establishes which
operations produced it. A suite may use both against the same run.

Drawing happens inside a frame, so a check advances at least one frame before it
reads anything. The engine clears the canvas at the top of every frame and draws
the complete picture, so what a read sees is the last frame alone.

## Pixel readback

The harness canvas is a `@napi-rs/canvas` canvas, and `getImageData` returns its
bytes. A sample is four bytes in `RGBA` order.

```ts
export function sample(h: Harness, x: number, y: number) {
  const view = h.engine.viewport();
  const ctx = h.canvas.getContext("2d");
  const [r, g, b, a] = ctx.getImageData(
    Math.round(view.offsetX + x * view.scale),
    Math.round(view.offsetY + y * view.scale),
    1,
    1,
  ).data;
  return { r, g, b, a };
}
```

### The logical-to-device mapping

A game draws in logical units and the canvas holds device pixels, so a sample
converts through the [viewport](/engines/simple-2d/concepts/viewport/):
`offsetX + x * scale` and `offsetY + y * scale`. `scale` is device pixels per
logical unit with the device pixel ratio already folded in, and the two offsets
are the letterbox bars.

With the harness reporting the logical design size at a device pixel ratio of
`1`, the scale is `1` and both offsets are `0`, so a logical coordinate is the
device coordinate. Building the harness at a ratio of `2` is how a check
exercises the mapping itself, and the conversion above keeps every other check
correct at both ratios.

### Sampling inside a shape

Take a sample at least two logical pixels inside the shape's edge. Curve edges
are anti-aliased, so a pixel on or near an edge blends the shape with what is
behind it, while an interior pixel carries the fill exactly.

An interior sample is byte-exact against the color the build was told to use,
so a fill is asserted on directly.

```ts
const { ball } = h.snapshot();
expect(sample(h, ball.x, ball.y)).toEqual({
  r: 0xf2,
  g: 0xf5,
  b: 0xf7,
  a: 255,
});
```

Reach for pixels when the claim is about the picture: the background color, a
shape's fill, whether something occupies a position on screen, whether the
letterbox bars are clear, whether an element moved between two frames.

## The recording proxy

`RenderApi.ctx` is whatever the canvas returned, so a suite substitutes its own
object by overriding `getContext` before the engine is created. A `Proxy` over
the real context records each call and each property assignment and forwards
both, which keeps the pixels correct while the stream is captured.

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
transform, a draw order, or a count of draws is read straight out of it.

```ts
const calls = recordDrawing(h);
await h.engine.advance(1);

const text = calls
  .filter((call) => call.method === "fillText")
  .map((call) => String(call.args?.[0]));

expect(text).toContain("SOLO");
```

Reach for the stream when the claim is about the operation rather than the
result: a string that was drawn, a shape that was stroked rather than filled, an
image that was drawn from the sprite sheet, the order two layers were drawn in.
Text is the clearest case, since the string is an argument and the pixels it
produced depend on the font the machine resolved.

## Choosing between them

Pixels answer "what does the player see at this point". The stream answers "what
did the build ask the context to do". A check states its claim in whichever of
those two the specification stated it in, and a claim about a color at a
position stays with pixels because a fill's arguments say nothing about where
the fill landed.
