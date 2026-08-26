---
title: Recording
---

The engine carries a flight recorder over the scene context. Armed, it keeps
every operation a frame issued, along with the renderer state that frame
inherited, so the frame can be drawn on its own. What comes back is the build's
own drawing rather than a re-shoot of it, which is what makes a recording
usable as evidence a reviewer sees beside the same scenario driven against the
reference implementation.

## A stable wrapper the game cannot escape

The scene context is engine-owned, so there is no wrapper over someone else's
context: the recorder is part of the drawing surface itself, built once when
the engine is constructed and handed out for the engine's whole life. The
identity a game holds is stable, arming is a flag inside the surface rather
than a substitution of one context for another, and the drawing a build
performs is the same whether or not anything is being captured.

Every operation is a call. The scene context declares no assignable properties,
so each recorded operation is one method call carrying its arguments, resolved
before the call is issued. Encoding runs behind a guard wherever the recorder
touches a value, so a cyclic object or a throwing getter records as an opaque
marker while the call proceeds. Two bounds keep the encoding finite: a
container reached at depth 32 records as a marker rather than being expanded,
and one encoded value expands into at most 65,536 values, with a container the
bound falls inside carrying its remainder as a single marker. Both bounds are a
fixed part of the format, so a player knows what any conforming document can
carry and reports a marker the same way wherever it came from.

The engine's own frame preparation sits inside the frame bracket with the
game's `render`: the clear with the depth state reset, the viewport fit, and
the renderer state in force. A replayed frame starts from the blank, correctly
fitted page the original started from.

## Retained state instead of a save stack

The scene context has no save stack, no clip machinery, and no current path.
Every draw call names its full world transform, and what survives a frame
boundary is exactly the renderer state: the camera, the lights, and the render
mode, each set through the context and holding until set again.

A frame's own operations are still not enough to draw it. A game that sets its
camera on its first frame relies on the renderer still carrying that camera a
thousand frames later, and a player that seeks straight to frame 900 has no
earlier frame to have inherited it from. Each frame therefore names the
renderer state it inherited, snapshotted before the frame's first operation.
Taking the snapshot at the end of the frame instead would record the state the
frame left behind, and replay would draw the frame's opening operations under
its closing camera.

The inherited light list holds at most 64 entries. A frame whose list the
recorder cut down says so, and a player reports it beside everything else it
could not reproduce, because a reviewer has to be able to tell a picture the
format could not carry from one it carried.

## Independent frames make scrubbing parallel

Drawing a frame means blanking the surface to the recording's background at the
size the frame recorded, with the depth state reset, restoring the renderer
state the frame inherited, and issuing its operations in order, and nothing
else. Seeking to a frame therefore costs what drawing that frame costs, and a
player jumps to frame 900 directly rather than replaying the 899 before it,
which is what makes a scrub bar responsive over a recording of any length.

Frame independence is exact, with no exceptions clause. The two carve-outs the
2D format carries, pixels written through a clip and antialiased clip edges,
have nothing to stand on here: there is no stack, no clip, and no operation
that writes around the frame's own drawing.

The same property is what lets two recordings be scrubbed in step. The frame
counter and the accumulated simulated time travel with each frame, so a
reviewer moves one control and both the build's recording and the reference
implementation's are drawn at the frame that control names, aligned on the
figure the engine stepped rather than on a wall clock. A 3D recording marks
itself as 3D in its envelope, which is what selects the player's 3D drawer;
the reviewer's one player serves every engine's recordings by that mark.

## Values the context produced

Procedural geometry and materials are created through the scene context and
drawn by handing back the value it returned, the 3D counterparts of gradients
and patterns. A use of such a value records as a reference into the recording's
resource table, and replay rebuilds it by re-issuing its recipe against the
context it is drawing into. The producing call belongs to the recipe rather
than to the frame, so every operation a frame holds is one the context
performed on itself.

A produced value is immutable, which removes most of what the 2D recorder does
for its resources. A recipe is the producing call alone, with no mutation list
to track, no moment-of-use resolution, and no corrective assignment ahead of a
paint. Two calls with the same arguments share one entry, so a game that
creates its geometry fresh on every frame costs the recording nothing over one
that made it once, and a value that is created and never used is left out
entirely.

## Capturing what a build draws with

A mesh, a texture, or a material a draw call names is part of the picture
rather than something beside it, so the recording carries the asset itself: a
mesh's file bytes, a texture's pixels, a material's maps as references to their
captured textures. A replay needs nothing from the run's tree.

A handle is immutable and loaded once, so it is keyed on its identity and
captured once, however many frames draw it. Capture stops once a recording
holds 16 MB of asset bytes; captured assets keep resolving, and a further new
capture records the opaque marker a player already reports, because a reviewer
who cannot load a replay at all is worse off than one looking at a replay that
names what it left out. An asset that fails to decode in the reviewer's browser
resolves to nothing, and an operation naming it is skipped and reported, so a
replay accounts for every operation it leaves out.

## Nine significant digits

Every number a recording carries as part of the drawing is written to at most
nine significant digits. The digits past nine describe the arithmetic that
produced a coordinate rather than the picture that coordinate draws, while a
full double expansion of a physics position costs seventeen characters per
number across every transform of every frame.

The frame metadata is exact. The frame counter, the accumulated simulated time,
the delta, and the backing store size are the axis a reviewer scrubs on and the
figures a check asserts against, so they are carried as the engine reported
them.

## One copy of each operation

Consecutive frames of a game issue very nearly the same operations, and a build
issues the identical draw call every frame for as long as an object sits still.
A recording therefore holds each distinct operation once and each distinct
inherited state once, and a frame names its state by index and its operations
by an array of indices. Assets and resources are shared the same way, on their
bytes and on their recipes.

Sharing is keyed on the entry itself, written canonically so that two equal
entries compare equal whatever order their fields were produced in. A
reviewer's browser parses and holds the whole document, so holding each entry
once bounds what a replay costs to load as well as what it costs to store. The
tables are settled when the recording is closed, from the frames it holds, so
every entry is one some frame names.

## The frame bracket excludes the overlay

A frame opens before the engine prepares the canvas and closes after the game's
`render` returns. The HUD a game draws through the scene context is inside the
bracket, because it is part of the build's picture; the
[diagnostics](/engines/simple-3d/concepts/diagnostics/) overlay draws on its
own surface, never touches the scene context, and never enters the recording,
because baking a debug panel into a reviewer's evidence would misreport what
the build drew.

The bracket is also what makes arming cheap to reason about. Capture begins at
the next frame, so a caller that arms the recorder mid-frame gets whole frames
rather than a frame whose clear and fit had already happened. A frame still
open when the recorder is disarmed is dropped, because the recording it would
have joined has already been handed to its caller.

## Armed around a section, idle otherwise

The recorder is armed and disarmed by whoever owns the engine, so a check
records the section of a scenario it is about and pays nothing for the setup
that got there. While it is idle a call costs one flag test, and the recorder
keeps one shadow: the renderer state, moved only by the three calls that set
it. Resource recipes are collected whether or not the recorder is armed,
because a build is free to create a material long before a caller arms the
recorder, and an immutable value's recipe is one producing call however long it
waits.

A recording holds what the build drew through the scene context, and the scene
context is the one surface the engine composes into the picture, so the
recording and the picture agree by construction.
