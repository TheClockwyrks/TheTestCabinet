---
title: The Camera and the Viewport
---

A game places its actors in world units of its own choosing. Two stages carry
those coordinates onto the screen: the camera projects the world into a fixed
logical design field, through a perspective or orthographic projection, and
the viewport maps that field onto the canvas's backing store. The engine owns
both maps, so a build states its rules in world units and reads the finished
picture back through the same two stages.

## World units are the game's own

A world unit means whatever the game decides it means, and the world it measures
is unbounded. An actor's transform may sit anywhere, a level may be far larger
than anything visible at once, and two actors far apart hold the distance
between them however the view moves.

Every rule a game states is stated in world units. A paddle 4 units wide is 4
units wide on a phone and on a 4K display, and the build's arithmetic is
identical in both places.

## The camera projects the world

The logical design field is fixed when the engine is created: one width and one
height that every frame shares. The camera decides what the field shows through
a position, a rotation, and a projection whose aspect is the field's own. Under
perspective the projection is a frustum set by a vertical field of view, so a
far object is smaller than a near one; under orthographic it is a box spanning
a stated number of world units vertically, so size on screen is independent of
distance. Either way the world is a volume and the field is its image, with a
depth beside every projected point.

A camera that has not been moved sits ten units in front of the origin looking
along `-Z` with `+Y` up, under perspective at a sixty-degree field of view, with
no bounds. A mesh placed at the origin is therefore in view before the game
touches the camera. Under orthographic at the default vertical span, one world
unit on the `z = 0` plane is one logical unit and the field's center is the
world origin, so a game with a single flat screen places its actors in world
units that read like the design field.

A camera may follow an actor instead of being driven directly. A following
camera adopts, each frame, the world transform and the field of view of the
camera component the actor carries, so the simulation sets the framing and the
component's offset sets where on the actor the eye sits. Bounds clamp the
camera's position inside a box of the world, one axis at a time, and leave the
projection as it stands, so a camera that reaches the edge of a level stops
moving and keeps looking where it was looking.

A render component may draw in the logical field directly by taking `screen`
space. The camera then plays no part in where it lands: the viewport alone
carries it onto the screen layer, which is how a HUD holds its place while the
camera follows the play.

## The viewport letterboxes the field onto the canvas

The scale is uniform: one minimum of the two axis ratios, the reported width
over the logical width and the reported height over the logical height. Keeping
one scale preserves the aspect ratio and holds the whole logical field on
screen.

The leftover space on the long axis is split into two equal bars, so the field
is centered rather than pinned to a corner. Those bars are the viewport's
offsets, and they are what letterboxing consists of. The world pass draws
through the same fit: the renderer's viewport and scissor are set to the
letterboxed rectangle, the whole canvas is cleared to the background before the
scissor is applied so the bars carry the background color, and the camera's
aspect is held at the field's ratio so the picture and the projection agree.

The device pixel ratio is folded into the scale rather than carried alongside
it, and the backing store is sized to the reported size multiplied by that
ratio. One transform derived from the viewport alone therefore lands logical
coordinates on the correct device pixels, and the picture is sharp on a
high-density display. The screen layer is sized to the same backing store, so
it composites over the world pass pixel for pixel.

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
fixes the viewport for the life of the run. Both maps are then known: the
camera maps a world point into the logical field and reports its depth and
whether it lies inside the frustum, and the viewport maps that logical point
onto the backing store.

A claim about where something appears on screen is checked by projecting the
world point through the camera and comparing the logical point it lands on,
and the same composition runs the other way: a logical point taken off the
field becomes a ray into the world, and the collision world says what it
meets. The screen layer is a 2D canvas the validator
supplied, so a HUD readout is sampled by device pixel and reads the same answer
on every machine.

## Resynced every frame

The fit is recomputed at the top of every frame rather than from a resize
handler. A window resize, a device pixel ratio change from a display switch, and
a layout change that fires no event at all therefore each correct themselves
within one frame, and the first frame draws into canvases that are already
sized. The camera's projection matrix is updated in the same place, so a change
to its field of view or its vertical span is in force for the frame that
follows the write.

The screen layer's transform is replaced each frame rather than composed onto
whatever the previous frame left, so a component may leave the context in any
state it likes and the next frame starts from the same blank page.

## A canvas with no size

A surface the browser has not laid out, or one hidden by `display: none`,
reports a size of zero. The viewport then reports a scale of zero, which keeps
an infinity and a `NaN` out of the transform and out of every draw that follows
it.

The backing stores are left as they stand, keeping the last frame drawn on
screen. That frame's draws land nothing, and the next frame recovers on its own
as soon as the surface has a size.
