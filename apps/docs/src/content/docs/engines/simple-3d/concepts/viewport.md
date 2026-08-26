---
title: The Viewport
---

A game simulates in world units and draws in a fixed logical design size, the
width and height it declared when the engine was created. The camera projects
the world into that logical field, and the viewport is the map from those
logical coordinates onto the canvas's backing store; the viewport is the only
thing that knows how large the canvas actually is.

## Three spaces

World space is the game's own: right-handed, +Y up, +X right, with a world unit
meaning whatever the game decides. Every rule a game states about its world it
states in world units, so a crate two units wide is two units wide on a phone
and on a 4K display, and the build's arithmetic is identical in both places.

The logical field keeps the 2D convention: origin at the top left, x right, y
down, in the logical units of the design size. Every screen-space position, the
pointer, a projected point, the HUD, is in logical coordinates, which is what
lets the pointer, the viewport, the overlay, and the recording metadata carry
over from the 2D engine unchanged. The flip between the y-up world and the
y-down field lives in the camera's projection and nowhere else.

Device space is the canvas backing store, in device pixels, reached from a
logical coordinate through the viewport's scale and offsets alone.

## The frustum camera

The world-to-logical stage is a perspective frustum, in place of the 2D
camera's position, zoom, and rotation map. The camera is a plain value: a
position and an orientation in world space, a vertical field of view in
radians, and near and far planes. The game keeps it in its own state and
applies it through the [scene context](/engines/simple-3d/apis/game/), where it
is retained until set again; the scene context is write-only, so the game's
state stays the single source of truth for where the camera is.

The frustum's aspect ratio is not a choice the camera carries: it is always the
design aspect, the declared width over the declared height. The horizontal
field of view follows from the vertical one, the picture is identical on every
canvas, and the viewport letterboxes it exactly as it letterboxes a 2D picture.
That is the 3D analog of fitting the logical design size, and it is what keeps
a fixed surface mapping to known pixels for a
[validator](/engines/simple-3d/validators/overview/).

## Projection and picking

Two pure functions are the whole projection contract, specified at
[the viewport API](/engines/simple-3d/apis/viewport/). `projectPoint` maps a
world point through the camera into logical coordinates, answering `null` for a
point at or behind the camera plane. `pointerRay` goes the other way, turning a
logical position into the world-space ray through it, which is the picking
convention: the pointer stays a 2D position, and mapping it into the scene is
done by whoever needs it.

Both take the camera as the plain value the game holds, so the camera the game
renders with is the one it picks against and the one a validator projects with.
A validator computes the device pixel a world point drew into as `projectPoint`
followed by the viewport map, the same two-stage composition a 2D check uses.

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
that ratio. The scale and the offsets alone therefore land a logical coordinate
on the correct device pixels, and the picture is sharp on a high-density
display. Both are consequently in device pixels, and the CSS-pixel figure is
the scale divided by the ratio.

There is no drawing transform to apply: the renderer itself maps the logical
field onto the letterboxed device rectangle and clears the bars outside the
picture, so the mapping a game or a validator computes from the viewport's
scale and offsets is the mapping the renderer performs.

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
dispatches its key events into the event target it owns, and the fit
arithmetic, the projection, and the picture it produces are the ones a browser
produces.

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

The renderer applies the recomputed fit each frame rather than keeping the
previous one, so every frame draws under the mapping the current measurement
produced.

## Order of work in one frame

1. The canvas is resynced to the surface's size and the current device pixel
   ratio, and the viewport is recomputed.
2. The frame is cleared, to the configured background color or to transparency,
   and the depth state is reset.
3. The game's update runs, with this frame's delta in seconds.
4. The game's render runs against the scene context, and the picture is
   complete when it returns.
5. The diagnostics overlay is drawn, on its own surface.
6. The input frame is closed, discarding edges nothing consumed.

Because step 2 clears the whole canvas, every frame draws the complete picture,
and a build reasons about one full redraw per frame. There is no retained scene
graph: what survives a frame boundary is the renderer state alone, the camera,
the lights, and the render mode.

## The overlay sits on its own surface

Step 5 draws the [diagnostics](/engines/simple-3d/concepts/diagnostics/)
overlay onto an engine-owned 2D surface composited above the rendering canvas,
in device pixels over the finished picture. Debug text is chrome laid on top of
the game rather than part of it, so it holds one physical size and stays crisp
however far the game's world is being scaled, and it lands clear of the
letterbox bars.

## A canvas with no size

A surface the browser has not laid out, or one hidden by `display: none`,
reports a size of zero. The viewport then reports a scale of zero and offsets
computed from it, which keeps an infinity or a `NaN` out of the fit and out of
every mapping computed from it.

The backing store is left as it is, keeping the last good frame on screen. That
frame's draws land nothing, and the next frame recovers on its own as soon as
the surface has a size.
