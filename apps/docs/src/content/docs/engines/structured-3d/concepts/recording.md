---
title: Recording
---

The engine carries a flight recorder over the scene context. Armed, it keeps
every operation a frame issued, along with the renderer state the frame
inherited, so that frame draws on its own. What comes back is the build's own
drawing rather than a re-shoot of it, which is what makes a recording usable as
evidence a reviewer sees beside the same scenario driven against the reference
implementation.

## A stable wrapper the game cannot escape

The rendering pipeline draws through the scene context, built once when the
engine is constructed and kept for the engine's whole life. Every built-in
render component draws through it, the collision overlay draws through it, and
a `DrawComponent` receives it as `DrawApi.scene`, so the whole picture passes
through the one context. The context performs every call whether or not
anything is being captured, so the pixels a build draws are the same either
way, and it collects frames only while it is armed.

The scene context is engine-owned, so arming is a flag inside it rather than a
substitution of one context for another. A `DrawComponent` that keeps the
context it was handed on an earlier frame holds the same object the pipeline
draws through, and its calls are recorded like every other draw.

That holds for any value a build draws with. Encoding runs behind a guard
wherever the recorder touches a value and carries the path it is walking, so a
cyclic object or a throwing getter records as an opaque marker while the call
itself is still performed. Two bounds keep the encoding finite: a container
reached at depth 32 records as a marker, and one encoded value expands into at
most 65,536 values, with a container the bound falls inside carrying its
remainder as a single marker. Both bounds are a fixed part of the format, so
the same drawing answers with the same document wherever it is recorded.

The engine's own frame preparation runs through the same bracket as the
pipeline, so the clear with its depth reset, the viewport fit, and the frame's
renderer-state sets are part of the recording. A replayed frame starts from the
blank, correctly fitted page the original started from.

## Retained state instead of a save stack

The scene context has no save stack, no clip region, and no current path. Each
draw call names its full world transform explicitly, so a frame's operations
carry their own geometry. What survives a frame boundary is the renderer state:
the camera, the lights, and the render mode, each set through the scene context
and holding until set again.

A frame's own operations are still not enough to draw it. A game whose camera
was set a thousand frames earlier relies on the context still holding it, and a
player that seeks straight to frame 900 has no earlier frame to have inherited
it from. Each frame therefore names the renderer state it inherited,
snapshotted before the frame's first operation, and drawing a frame means
applying what it inherited and replaying that frame's operations, and nothing
else.

The inherited state's light list holds at most 64 entries. A frame that
inherited a list the recorder cut down says so, and a player reports it beside
everything else it could not reproduce, because a reviewer has to be able to
tell a picture the format could not carry from one it carried.

## Independent frames make scrubbing parallel

Every frame is drawable on its own. A frame carries the whole of the renderer
state it opened with, and the values its operations draw with live in tables
the whole recording shares, so an inherited camera or a procedural material
resolves at whichever frame a player lands on.

Seeking to a frame therefore costs what drawing that frame costs, and a player
jumps to frame 900 directly rather than replaying the 899 before it, which is
what makes a scrub bar responsive over a recording of any length. With no save
stack, no clip, and no path, frame independence carries no exceptions clause:
where the 2D format carves out `putImageData` and antialiased clips, a 3D frame
drawn on its own reproduces what was on screen exactly.

The same property is what lets two recordings be scrubbed in step. A reviewer
moves one control and both the build's recording and the reference
implementation's are drawn at the frame that control names, with neither of
them having to be replayed from the beginning. The frame counter and the
accumulated simulated time travel with each frame, so the two are aligned on
the figure the engine stepped rather than on a wall clock.

## Values the context produced

Some of what a build draws with is created through the scene context itself:
the procedural geometries and the materials built in code, through the
producing methods the [recording](/engines/structured-3d/apis/recording/)
API names. A use of such a value records as a reference into the
recording's resource table, and replay rebuilds the value by re-issuing the
producing call against the context it is drawing into.

A produced value is immutable, so its recipe is the producing call alone and
its identity is the call that made it. Two calls with the same arguments share
one table entry, which is what makes creating a geometry or a material per
frame cost nothing in the recording, and a value that is created and never used
is left out entirely. Produced values are tracked from the moment the context
creates them, armed or not, because a build is free to create its materials
once and draw with them for the rest of its life.

## Capturing what a build draws with

A mesh-based build spends most of its operations drawing loaded assets, so the
assets those calls draw from are part of the picture rather than something
beside it. Every handle an operation names is captured into the recording: a
mesh as its file's bytes, a texture as its pixels, and a material as the
captured textures its slots hold. A replay therefore needs nothing from the
run's tree.

A handle is immutable and loaded once, so it is keyed on its identity and
captured once, however many frames draw it. The sprite-sheet economics of 2D
carry over: a mesh a thousand frames draw costs one entry.

Capture stops once a recording holds 16 MB of asset bytes. Assets already
captured keep resolving, and a further new capture records the opaque marker a
player already reports, because a reviewer who cannot load a replay at all is
worse off than one looking at a replay that names the asset it left out. A
captured asset that fails to decode in a reviewer's browser resolves to
nothing, and an operation naming it is skipped and reported alongside the
opaque ones, so a replay accounts for every operation it leaves out.

## Nine significant digits

Every number a recording carries as part of the drawing is written to at most
nine significant digits. The digits past that describe the arithmetic that
produced a coordinate rather than the picture that coordinate draws, while a
full double expansion of a physics position costs seventeen characters per
number across every operation of every frame.

The frame metadata is exact. The frame counter, the accumulated simulated time,
the delta, and the backing store size are the axis a reviewer scrubs on and the
figures a check asserts against, so they are carried as the engine reported
them.

## One copy of each operation

Consecutive frames of a game issue very nearly the same operations, and a build
issues the identical draw call every frame for as long as an actor sits still.
A recording therefore holds each distinct operation once and each distinct
renderer-state block once, and a frame names its state by index and its
operations by an array of indices. Assets and resources are shared the same
way, on the handle's identity and on the producing call.

Sharing is keyed on the entry itself, written canonically so that two equal
entries compare equal whatever order their fields were produced in. A
reviewer's browser parses and holds the whole document, so holding each entry
once bounds what a replay costs to load as well as what it costs to store. The
tables are settled when the recording is closed, from the frames it holds, so
every entry is one some frame names.

## The frame bracket excludes the diagnostics overlay

A frame opens before the engine prepares the canvas and closes after the
[pipeline](/engines/structured-3d/concepts/rendering/) has drawn, which leaves
the [diagnostics](/engines/structured-3d/concepts/diagnostics/) overlay outside
it. The overlay is chrome drawn on its own 2D surface above the rendering
canvas, so it never passes through the scene context at all, and a reviewer's
evidence carries what the build drew with no debug panel baked in.

The collision overlay is inside the bracket. It is a render switch, drawn by
the pipeline as the last part of the picture, so a recording taken with the
switch on carries every collider's shape over the drawing, in the same frame
that drew it. A reviewer who wants the build's picture alone records with the
switch off.

The bracket is also what makes arming cheap to reason about. Capture begins at
the next frame, so a caller that arms the recorder mid-frame gets whole frames
rather than a frame whose clear and renderer-state sets had already happened. A
frame still open when the recorder is disarmed is dropped, because the
recording it would have joined has already been handed to its caller.

## Armed around a section, idle otherwise

The recorder is armed and disarmed by whoever owns the engine, so a check
records the section of a scenario it is about and pays nothing for the setup
that got there. While it is idle the scene context performs each operation and
keeps two shadows: the retained renderer state, which only the state-setting
calls move, and the recipe of each value the context produced. A frame inherits
the first and a build establishes both long before a caller arms the recorder,
so they are maintained whenever the engine exists, and an engine that is never
asked to record holds what its own state and produced values are worth, and
nothing per frame.

A recording holds what was drawn through the scene context the pipeline draws
through. A `DrawComponent` that draws to a surface of its own is drawing
outside the recording, and a frame that emits no operations while its pixels
change is the signal that it did.
