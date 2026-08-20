---
title: Viewport
---

A game draws in the logical design size it declared to `createEngine`. The
viewport is the affine map from those logical coordinates onto the canvas's
backing store, and it is recomputed at the top of every frame from the size and
device pixel ratio the [surface](/engines/simple-2d/apis/engine/) reports.

## `Viewport`

```ts
interface Viewport {
  readonly width: number;
  readonly height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}
```

| Field | Meaning |
| --- | --- |
| `width` | The logical design width. A game draws in `0..width`. |
| `height` | The logical design height. A game draws in `0..height`. |
| `scale` | Device pixels per logical unit, with the device pixel ratio folded in. |
| `offsetX` | The left letterbox bar, in device pixels. |
| `offsetY` | The top letterbox bar, in device pixels. |

`scale` and both offsets are device pixels. The CSS-pixel figure is `scale`
divided by the device pixel ratio.

## The mapping

```ts
deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;

logicalX = (deviceX - offsetX) / scale;
logicalY = (deviceY - offsetY) / scale;
```

The backing store is addressed in device pixels, so a validator reading pixels
back maps its logical point through the first pair before asking for it:
`ctx.getImageData(deviceX, deviceY, 1, 1)` names the pixel a logical point drew
into. A validator that pins the surface to a known size and ratio therefore
knows the exact pixel to sample.

A pointer event reports its position in CSS pixels relative to the element, so
it multiplies by the device pixel ratio before the inverse map:
`(cssX * dpr - offsetX) / scale`.

## `fitViewport`

```ts
function fitViewport(
  logicalWidth: number,
  logicalHeight: number,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport;
```

The scale is uniform: the smaller of `cssWidth / logicalWidth` and
`cssHeight / logicalHeight`, multiplied by `dpr`. A single scale preserves the
aspect ratio and keeps the whole logical field visible.

The leftover space on the long axis is split into two equal bars, which are the
offsets. They are computed against the rounded device size the backing store is
written at, so the two bars sum to the drawable area exactly and neither edge
carries a sub-pixel seam.

A degenerate input yields a `scale` of `0` and offsets derived from it: a
container measuring zero on either axis, or a logical size that is not finite
and positive. A ratio that is not finite and positive is read as `1`. A zero
scale draws nothing for the frame it applies to, and the fit recovers on its own
once the element has a size.

## `applyViewport`

```ts
function applyViewport(ctx: CanvasRenderingContext2D, viewport: Viewport): void;
```

Sets the context transform to the viewport, as
`setTransform(scale, 0, 0, scale, offsetX, offsetY)`. The transform is replaced
rather than composed, so every frame starts from the viewport whatever state the
previous frame's render left the context in.

## `syncCanvas`

```ts
function syncCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  surface: SurfaceMetrics,
): Viewport;
```

Brings the canvas's backing store in line with the size and ratio the surface
reports, and returns the fit. The engine calls it at the top of every frame, and
once during construction so the first read of `viewport()` and the game's
`initialize` see a real fit.

The backing store is `round(cssWidth * dpr)` by `round(cssHeight * dpr)`,
written only when it differs from the current values, since assigning
`canvas.width` reallocates and clears the canvas.

A surface reporting zero on either axis leaves the backing store as it stands,
which keeps the last good frame on screen, and returns a viewport whose scale is
zero.

## Pinning the CSS size

The engine pins a pixel CSS size onto the canvas only when the page has
expressed none.

An element the page has not sized takes its CSS size from the `width` and
`height` attributes, which are exactly what the backing store writes. Writing
the backing store then feeds into the next measurement, and the element grows by
the device pixel ratio on every frame. Pinning the measured size breaks that
loop.

| Measurement | The engine writes |
| --- | --- |
| The reported CSS size equals the size the backing-store attributes imply | `style.width` and `style.height` in pixels, equal to the measurement, alongside the backing store |
| The page sized the element, inline or through a stylesheet | The backing store alone |

A canvas styled to follow its container therefore keeps following it at whatever
size the container currently has, and a canvas dropped into a page that styles
nothing settles at its declared attribute size. A canvas that exposes no style,
such as one driven headlessly behind a supplied surface, keeps the size the
surface reports.

## Measuring through the surface

Every figure the fit is computed from arrives through
[`SurfaceMetrics`](/engines/simple-2d/apis/engine/): `cssWidth()`, `cssHeight()`,
and `dpr()`. The default surface reads the canvas's `clientWidth`,
`clientHeight`, and the owning window's `devicePixelRatio`, so a canvas inside an
iframe is sized by the ratio of the display it is actually on.

A supplied surface replaces every one of those measurements. Fixed figures give
a fixed fit, which is what lets the engine run over a canvas with no document
behind it and gives a validator the same transform on every machine.

## Reading the viewport

`engine.viewport()` and the `viewport()` on each of `InitApi`, `UpdateApi`, and
`RenderApi` return the current fit. Each call returns a snapshot the caller owns,
so a held viewport keeps the values of the frame it was read in.

## Exports

`Viewport` is exported as a type, and `fitViewport`, `applyViewport`, and
`syncCanvas` as functions, from `@test-cabinet/simple-2d`.
