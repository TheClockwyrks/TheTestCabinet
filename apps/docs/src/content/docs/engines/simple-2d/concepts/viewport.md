---
title: The Viewport
---

A game draws in a fixed logical design size, the width and height it declared
when the engine was created. The viewport is the affine map from those logical
coordinates onto the canvas's backing store, and it is the only thing that knows
how large the canvas actually is.

Every rule a game states is stated in logical units. A paddle 96 units wide is
96 units wide on a phone and on a 4K display, and the build's arithmetic is
identical in both places.

## The fit

The scale is uniform: a single minimum of the two axis ratios, the surface's
width over the logical width and the surface's height over the logical height.
Keeping one scale preserves the aspect ratio and holds the whole logical field
on screen.

The leftover space on the long axis is split into two equal bars, so the field
is centred rather than pinned to a corner. Those bars are the viewport's
offsets, and they are what letterboxing consists of.

The device pixel ratio is folded into the scale rather than carried alongside
it, and the canvas backing store is sized to the surface's size multiplied by
that ratio. One transform derived from the viewport alone therefore lands
logical coordinates on the correct device pixels, and the picture is sharp on a
high-density display. The scale and the offsets are consequently in device
pixels, and the CSS-pixel figure is the scale divided by the ratio.

## The measurement seam

The engine reads the canvas's laid-out size and the current device pixel ratio
through the surface supplied when it was created, and attaches its key listeners
to the event target that surface returns. Every measurement the fit is computed
from arrives through that one seam.

With no surface supplied, the engine measures the canvas element itself and
listens on its owning document, which is the arrangement a page in a browser
gets by default.

Supplying a surface puts the engine over a canvas with no document behind it. A
validator running in process hands the engine a fixed size and ratio and
dispatches its key events into the event target it owns, and the fit arithmetic,
the transform, and the pixels it reads back are the ones a browser produces.

## Sizing the canvas

The backing store is written only when the computed size differs from the
current one, since assigning it reallocates and clears the canvas.

The engine writes a pixel CSS size onto the canvas element only when the page
has expressed none for it. A page that has styled the canvas keeps its own rule
and the element goes on following the layout, because a fixed pixel size written
over that rule would freeze the canvas at the size it was first measured at.

## Resynced every frame

The fit is recomputed at the top of every frame rather than from a resize
handler. A window resize, a device pixel ratio change from a display switch, and
a layout change that fires no event at all therefore all correct themselves
within one frame, and the first frame draws into a canvas that is already sized.

The transform is replaced each frame rather than composed onto whatever the
previous frame left, so a game may leave the context in any state it likes and
the next frame starts from the same blank page.

## Order of work in one frame

1. The canvas is resynced to the surface's size and the current device pixel
   ratio, and the viewport is recomputed.
2. The frame is cleared, to the configured background color or to transparency.
3. The viewport transform is applied to the drawing context, and the context
   is clipped to the logical field.
4. The game's update runs, with this frame's delta in seconds.
5. The game's render runs against that transformed, clipped context.
6. The clip is lifted and the diagnostics overlay is drawn.
7. The input frame is closed, discarding edges nothing consumed.

Because step 2 clears the whole canvas, every frame draws the complete picture,
and a build reasons about one full redraw per frame. Because step 3 clips to
the field, a draw that reaches past `0..width` or `0..height` stops at the
letterbox bar, and the bars hold the background alone.

The clip is opened with a `save` in step 3 and lifted with the matching
`restore` in step 6, so a style or transform the game sets inside a frame lasts
until the frame closes. A `save` the game leaves open is what that `restore`
pops instead: the clip stays in force through the next frame's clear and over
the overlay drawn that frame, and the next frame opens on the state the game had
at that `save`. A `restore` beyond the game's own `save`s lifts the clip for the
rest of that frame.

## The overlay sits outside the transform

Step 6 resets the transform to the identity and draws the overlay in device
space, over the finished picture. Debug text is chrome laid on top of the game
rather than part of it, so it holds one physical size and stays crisp however
far the game's own coordinates are being scaled, and it lands clear of the
letterbox bars.

## A canvas with no size

A surface the browser has not laid out, or one hidden by `display: none`,
reports a size of zero. The viewport then reports a scale of zero and offsets
computed from it, which keeps an infinity or a `NaN` out of the transform and
out of every draw that follows it.

The backing store is left as it is, keeping the last good frame on screen. That
frame's draws land nothing, and the next frame recovers on its own as soon as
the surface has a size.
