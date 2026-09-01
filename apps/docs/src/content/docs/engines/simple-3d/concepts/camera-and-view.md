---
title: The Camera and the View
---

A game places its objects in world units of its own choosing. Two stages carry
those coordinates onto the screen: the camera projects the world into a fixed
logical design field, and the viewport maps that field onto the canvas's
backing store. The engine owns the camera object and the viewport, the game
poses the camera from `render`, and the view is how any part of the game or a
caller outside it reads the camera back and moves a point between the world
and the stage.

## World units are the game's own

A world unit means whatever the game decides it means, and the world it measures
is unbounded. An object may sit anywhere in the scene, a level may be far larger
than anything visible at once, and two objects far apart hold the distance
between them however the camera moves.

Every rule a game states is stated in world units. A crate one unit across is
one unit across on a phone and on a 4K display, and the build's arithmetic is
identical in both places.

## The three spaces

| Space | Unit | Set by |
| --- | --- | --- |
| World | World units | The game, on every scene object |
| Logical | The design size handed to `createEngine` | The camera's projection, at aspect `width / height` |
| Device | Device pixels | The viewport |

The camera carries the first mapping and the viewport the second. A world point
goes through the camera's view and projection matrices into normalized device
coordinates, and those land on the logical field with `x` running rightward and
`y` running downward from the top-left corner, the same axes the screen layer
draws on and the pointer reports in. The
[viewport](/engines/simple-3d/concepts/viewport/) then scales and offsets the
logical point onto the backing store.

The world is right-handed with `+Y` up, and the camera looks along its local
`-Z`, which is three's convention. A game reasons about the world in those
terms and about the stage in logical units, and the two meet only through the
camera.

## The camera is posed from render

The engine creates one camera at construction, perspective or orthographic as
the `projection` option selects, at the camera defaults: position `(0, 0, 10)`
with the identity rotation, looking along `-Z` with `+Y` up. A perspective
camera starts at a vertical field of view of 60 degrees, and an orthographic
one spans the design size, so at the orthographic defaults a world unit on the
`z = 0` plane is one logical unit, with the world origin at the center of the
design field and world `+Y` pointing up the screen. A game with a single fixed
view therefore places its objects around the origin and leaves the camera
alone.

`render` poses the camera by writing its position, its orientation through
`lookAt`, `quaternion`, or `rotation`, its `fov`, `near`, and `far`, or an
orthographic camera's extents. The camera is engine-owned and game-posed: the
engine holds a perspective camera's aspect at `width / height` and updates the
projection matrix before rendering, and what `render` wrote is that frame's
picture. The framing is derived from the state each frame, so an orbit, a
follow, or a cut is a function of the simulation and reproduces with it.

The camera's class holds for the engine's life. A perspective game and an
orthographic game each declare which they are once, and the read side reports
which projection it found.

## The view is read from update

The view is the camera as it stood at the most recent render. The engine reads
the camera's world and projection matrices after each `render`, and every
`view()` answers from that reading until the next render. Before the first
render it answers from the camera defaults. A snapshot of the camera is a copy
the caller owns, and a ray or a projected point is a fresh value, so nothing a
caller holds is written by a later render.

Reading at the render is what makes the view mean one thing. `update` runs
before `render` on every frame, so the camera the player is looking through
while their input arrives is the one the previous frame drew, and that is the
camera `update` picks against. `render` reads the previous frame's view as
well, so a readout it anchors to a world point lands where the previous
frame's camera placed it, which coincides with this frame's whenever the camera
is still.

The view is the one part of the camera `update` can reach, because a frame's
audible and observable behavior is decided by `update` alone and a camera it
could write would put a drawing decision inside the simulation. The view is
read-only in every function that
holds it, and the same object answers from `engine.view()` for a caller
outside the game.

## Picking with a ray

The pointer arrives in logical stage coordinates, and a click is a claim about
a line through the world rather than a point on it. The view turns a logical
point into a world-space ray: through a perspective camera the ray starts at
the camera's position and points through the stage point, and through an
orthographic camera it starts at the stage point on the near plane and points
along the camera's view direction. Either way the ray's direction is unit
length, so a distance along it is in world units.

`update` intersects that ray against the simulation's own shapes: the ground
plane a cursor lands on, the sphere around a target, the box a crate occupies.
The pick is therefore a function of the state and the view, both of which a
validator holds, so a case checks what a click at a logical point selects by
delivering the pointer at that point and reading the state the update left.

## Projecting a point

Projecting runs the other way. A world point goes through the camera to the
logical stage point it draws at, together with its normalized device depth and
whether it lies inside the camera's frustum. The screen layer draws in the same
logical coordinates the projection reports, so a label anchored to a world
point is drawn at the projected point as it stands.

A point outside the frustum still reports a stage point and a depth, and a point
behind the camera reports that it is out of view. A game reads the flag before
drawing a readout, and a validator reads the projection to check where a world
point appears on the stage without sampling a pixel.

## The listener stands at the camera

A cue played at a world point is heard from where the camera stands. The
listener is the camera as it stood at the most recent render, the same reading
the view answers from, and the engine updates the listener's position and
orientation every frame. A loop placed at a fixed point therefore moves across
the stereo field as the camera turns, and a cue played beside the camera is
louder than one played far from it.

Positioning is per call rather than per cue. A cue played with a position is
routed through a panner, a cue played without one plays as it does in 2D, and
a running loop is moved by placing it again, so the same cue serves as a
world-placed sound in one call and a menu click in the next.

## What a fixed size buys a validator

A validator hands the engine a fixed size and a fixed device pixel ratio, which
fixes the viewport for the life of the run, and it reads the camera's pose
through the view after any number of frames. Both mappings are then known: the
camera maps a world point into the logical field, and the viewport maps that
logical point onto the backing store.

A check therefore computes the exact logical point a world point draws at and
asserts on it, and computes the device pixel the screen layer drew a readout
into and samples it, reading the same answer on every machine. The same
composition runs the other way for a point taken off the stage, through the
inverse viewport map and then the ray.

## The camera belongs to the engine

The camera is engine-held rather than game state. It lives on the engine from
construction and is the object the renderer reads, so it survives every state
the game moves through and is posed afresh each frame from the state `render`
is handed. A
game that wants its framing to be part of the simulation keeps the eye and the
focus in the state and writes them onto the camera every render, so a validator
posing the state through a transition poses the framing with it.

What the state carries is the plain numbers the camera is posed from, and what
the camera carries is the three object the renderer reads. The view is the
bridge between them, reporting the pose as plain values a caller compares
against the state that produced it.
