---
title: The Camera and the Viewport
---

A game places its actors in world units of its own choosing. Two stages carry
those coordinates onto the screen: the camera projects a region of the world
into a fixed logical design field, and the viewport maps that field onto the
canvas's backing store. The engine owns both maps, so a build states its rules
in world units and reads the finished picture back through the same two stages.

## World units are the game's own

A world unit means whatever the game decides it means, and the world it measures
is unbounded. An actor's transform may sit anywhere, a level may be far larger
than anything visible at once, and two actors far apart hold the distance
between them however the view moves.

Every rule a game states is stated in world units. A paddle 96 units wide is 96
units wide on a phone and on a 4K display, and the build's arithmetic is
identical in both places.

## The camera projects a region of the world

The logical design field is fixed when the engine is created: one width and one
height that every frame shares. The camera decides which region of the world
that field shows, through a position, a zoom, and a rotation. Zoom is logical
units per world unit, so it is the dial that sets how much of the world is
visible at once.

A camera that has not been moved sits at the center of the design field at a
zoom of one, with no bounds, so world coordinates and logical coordinates
coincide. A game with a single screen therefore places its actors directly in
the design field and never touches the camera.

A camera may follow an actor instead of being driven directly. A following
camera takes its position and zoom each frame from the view target the actor
carries, so the simulation sets the framing. Bounds hold the visible region
inside a rectangle of the world, and an axis whose visible extent exceeds the
bounds on that axis centers on them, so a level narrower than the view stays
centered.

A render component may draw in the logical field directly by taking `screen`
space. The camera then plays no part in where it lands: the viewport alone
carries it onto the canvas, which is how a HUD holds its place while the camera
follows the play.

## The viewport letterboxes the field onto the canvas

The scale is uniform: one minimum of the two axis ratios, the reported width
over the logical width and the reported height over the logical height. Keeping
one scale preserves the aspect ratio and holds the whole logical field on
screen.

The leftover space on the long axis is split into two equal bars, so the field
is centered rather than pinned to a corner. Those bars are the viewport's
offsets, and they are what letterboxing consists of. They hold the background
alone: the pipeline clips every component to the logical field, so a world
component projected past the field's edge stops at the bar.

The device pixel ratio is folded into the scale rather than carried alongside
it, and the backing store is sized to the reported size multiplied by that
ratio. One transform derived from the viewport alone therefore lands logical
coordinates on the correct device pixels, and the picture is sharp on a
high-density display.

## The camera belongs to the world

The camera is world state. It is built with the world at its defaults and torn
down with it: a [level transition](/engines/structured-2d/concepts/world/)
rebuilds the camera alongside the game mode, the game state, and every actor.
What crosses a transition is the game instance and what it holds.

A level that wants a particular framing states it as the level opens. An
incoming level therefore begins from the defaults, and the framing of the
outgoing level goes with the world that set it.

## The measurement seam

Every figure the fit is computed from arrives through the surface: the canvas's
laid-out CSS size and the current device pixel ratio. The engine reads both at
the top of every frame and attaches its key listeners to the event target the
same surface returns, so one seam carries the measurement and the input alike.

With no surface supplied, the engine measures the canvas element itself and
listens on its owning document, which is the arrangement a page in a browser
gets by default. A supplied surface replaces every one of those measurements,
which is what puts the engine over a canvas with no document behind it.

## What a fixed size buys a validator

A validator hands the engine a fixed size and a fixed device pixel ratio, which
fixes the viewport for the life of the run. Both transforms are then known: the
camera maps a world point into the logical field, and the viewport maps that
logical point onto the backing store.

A check therefore computes the exact device pixel a world point drew into and
samples that pixel, and it reads the same answer on every machine. The same
composition runs the other way for a point taken off the backing store.

## Resynced every frame

The fit is recomputed at the top of every frame rather than from a resize
handler. A window resize, a device pixel ratio change from a display switch, and
a layout change that fires no event at all therefore each correct themselves
within one frame, and the first frame draws into a canvas that is already sized.

The transform is replaced each frame rather than composed onto whatever the
previous frame left, so a component may leave the context in any state it likes
and the next frame starts from the same blank page.

## A canvas with no size

A surface the browser has not laid out, or one hidden by `display: none`,
reports a size of zero. The viewport then reports a scale of zero, which keeps
an infinity and a `NaN` out of the transform and out of every draw that follows
it.

The backing store is left as it stands, keeping the last frame drawn on screen.
That frame's draws land nothing, and the next frame recovers on its own as soon
as the surface has a size.
