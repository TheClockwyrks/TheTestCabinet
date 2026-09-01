---
title: The Viewport
---

A game draws in a fixed logical design size, the width and height it declared
when the engine was created. The viewport is the affine map from those logical
coordinates onto the canvas's backing store, and it is the only thing that knows
how large the canvas actually is. One fit places both of the engine's surfaces:
the renderer draws the scene into the rectangle the fit describes, and the
screen layer's context carries the fit as its transform, so the two line up
pixel for pixel.

Every rule a game states is stated in logical units where it draws on the
screen layer, and in world units where it places objects in the scene. A
readout 96 units wide is 96 units wide on a phone and on a 4K display, the
camera's projection lands the same world point on the same logical point on
both, and the build's arithmetic is identical in both places.

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

## One fit, two surfaces

The screen layer takes the fit as the 2D engines' canvas does. Its context is
given the viewport transform at the top of every frame, so a game draws its
readouts in `0..width` by `0..height` and the transform carries them into the
letterboxed rectangle on the backing store with the bars folded in.

The renderer takes the same fit as a viewport and a scissor. Before the scene
is rendered, the renderer's viewport and scissor are set to the rectangle
`offsetX, offsetY, width * scale, height * scale` in device pixels with the
scissor test on, so the scene is drawn into exactly the region the screen
layer's transform maps onto. The whole canvas is cleared to the configured
background color, or to transparency, before the scissor is applied, so the
letterbox bars carry the background and the scene's own background paints
inside the viewport alone.

The camera absorbs the difference between the design aspect and the element's.
A perspective camera's `aspect` is held at `width / height` and its projection
matrix updated every frame, so the picture keeps the design aspect whatever
shape the canvas is and the bars take up the rest. At its defaults an
orthographic camera spans the design size, so a world unit on the `z = 0` plane
is one logical unit and a game with a single fixed view places its objects
directly in the design field.

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
the transform, the renderer's rectangle, and the pixels it reads back from the
screen layer are the ones a browser produces.

## Sizing the canvases

The backing store is written only when the computed size differs from the
current one, since assigning it reallocates and clears the canvas.

The screen canvas is synced to the same backing store size as the stage canvas,
taking the size the stage canvas was synced to. The screen layer's texture then
covers the 3D picture exactly when it is composited, and a device pixel on one
surface is the same device pixel on the other.

The engine writes a pixel CSS size onto the stage canvas element only when the
page has expressed none for it. A page that has styled the canvas keeps its own
rule and the element goes on following the layout, because a fixed pixel size
written over that rule would freeze the canvas at the size it was first
measured at.

## Resynced every frame

The fit is recomputed at the top of every frame rather than from a resize
handler. A window resize, a device pixel ratio change from a display switch, and
a layout change that fires no event at all therefore all correct themselves
within one frame, and the first frame draws into canvases that are already
sized.

The screen layer's transform is replaced each frame rather than composed onto
whatever the previous frame left, so a game may leave the context in any state
it likes and the next frame starts from the same blank page. The renderer's
viewport and scissor are set afresh each frame from the same fit, and the
camera's aspect is held to the design aspect each frame, so the two surfaces
follow a resize together.

## Order of work in one frame

1. Both canvases are resynced to the surface's size and the current device
   pixel ratio, and the viewport is recomputed.
2. The screen layer is cleared and given the viewport transform.
3. The game's update runs, with this frame's delta in seconds.
4. The game's render runs, updating the scene and posing the camera, and
   drawing on the transformed screen context.
5. Under `webgl`, the whole canvas is cleared to the configured background
   color or to transparency, the letterboxed viewport and scissor are applied,
   and the scene is rendered through the camera.
6. The diagnostics overlay is drawn on the screen layer.
7. Under `webgl`, the screen layer is composited over the picture.
8. The input frame is closed, discarding edges nothing consumed.

Because step 2 clears the screen layer and step 5 clears the whole canvas
before drawing the scene, every frame draws the complete picture from what the
scene holds and what the render drew, and a build reasons about one full
redraw per frame.

## The overlay sits outside the transform

Step 6 resets the screen layer's transform to the identity and draws the overlay
in device space, over everything the game drew there that frame and, once
composited, over the scene. Debug text is chrome laid on top of the game rather
than part of it, so it holds one physical size and stays crisp however far the
game's own coordinates are being scaled, and it lands clear of the letterbox
bars.

## A canvas with no size

A surface the browser has not laid out, or one hidden by `display: none`,
reports a size of zero. The viewport then reports a scale of zero and offsets
computed from it, which keeps an infinity or a `NaN` out of the transform, out
of the renderer's rectangle, and out of every draw that follows it.

The backing stores are left as they are, keeping the last good frame on screen.
That frame's screen draws land nothing, the renderer's rectangle has no area,
and the next frame recovers on its own as soon as the surface has a size.
