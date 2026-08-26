---
title: The Camera and the Viewport
---

A game places its actors in world units of its own choosing. Two stages carry
those coordinates onto the screen: the camera's frustum projects the world into
a fixed logical design field, and the viewport maps that field onto the
canvas's backing store. The engine owns both maps, so a build states its rules
in world units and reads the finished picture back through the same two stages.

## World units are the game's own

A world unit means whatever the game decides it means, and the world it
measures is unbounded. An actor's transform may sit anywhere, a level may be
far larger than anything visible at once, and two actors far apart hold the
distance between them however the view moves.

Every rule a game states is stated in world units. A ship 96 units long is 96
units long on a phone and on a 4K display, and the build's arithmetic is
identical in both places.

## One set of conventions

The world is right-handed, with +Y up and +X right. A camera looks down its
local −Z, front faces wind counter-clockwise, and every angle is in radians,
rotations and field of view alike.

The logical design field keeps the 2D convention: origin top-left, x right,
y down, in logical units. The flip between the y-up world and the y-down field
lives in the projection's normalized-device-coordinate step and nowhere else,
which is what lets the pointer, the viewport, and the overlay carry the 2D
rules unchanged.

## The camera projects through a frustum

The logical design field is fixed when the engine is created: one width and one
height that every frame shares. The camera decides what the field shows through
a position, an orientation, and a vertical field of view, bounded by a near and
a far plane. Framing is those three dials: closer is moving the camera or
narrowing the field of view.

The frustum's aspect ratio is always the design aspect, the field's width over
its height. The picture is therefore identical on every canvas, letterboxed by
the viewport exactly as a 2D picture is, and a fixed surface keeps mapping to
known pixels.

A camera that has not been moved sits at its defaults, looking down −Z from a
short distance up the z axis, so a game that places its scene in front of the
origin draws with no camera code at all. A camera may instead follow an actor:
a following camera takes its position, its orientation, and its field of view
each frame from the camera component the view target carries, so the simulation
sets the framing. A frustum has no clamp rectangle, so a game that confines its
framing writes the confinement into the code that moves the camera.

## The viewport letterboxes the field onto the canvas

The scale is uniform: one minimum of the two axis ratios, the reported width
over the logical width and the reported height over the logical height. Keeping
one scale preserves the aspect ratio and holds the whole logical field on
screen.

The leftover space on the long axis is split into two equal bars, so the field
is centered rather than pinned to a corner. Those bars are the viewport's
offsets, and they are what letterboxing consists of.

The device pixel ratio is folded into the scale rather than carried alongside
it, and the backing store is sized to the reported size multiplied by that
ratio. The renderer draws inside the fit and clears the bars outside the
picture, so logical coordinates land on the correct device pixels and the
picture is sharp on a high-density display.

## The camera belongs to the world

The camera is world state. It is built with the world at its defaults and torn
down with it: a [level transition](/engines/structured-3d/concepts/world/)
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
fixes the viewport for the life of the run. Both stages are then known: the
projection maps a world point into the logical field, and the viewport maps
that logical point onto the backing store.

A check therefore computes the exact device pixel a world point drew into,
projecting the point and then applying the viewport's two linear equations, and
it reads the same answer on every machine. The same composition runs the other
way for picking: a logical point yields a ray from the camera through that
point, which is how a pointer position is carried into the scene.

## Resynced every frame

The fit is recomputed at the top of every frame rather than from a resize
handler. A window resize, a device pixel ratio change from a display switch,
and a layout change that fires no event at all therefore each correct
themselves within one frame, and the first frame draws into a canvas that is
already sized.

The fit is applied fresh each frame rather than carried from the previous one,
so every frame draws into the letterboxed rectangle the current measurement
names and starts from the same blank page.

## A canvas with no size

A surface the browser has not laid out, or one hidden by `display: none`,
reports a size of zero. The viewport then reports a scale of zero, which keeps
an infinity and a `NaN` out of the fit and out of every projection that follows
it.

The backing store is left as it stands, keeping the last frame drawn on screen.
That frame's draws land nothing, and the next frame recovers on its own as soon
as the surface has a size.
