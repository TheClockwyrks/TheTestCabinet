---
title: Recording
---

The engine carries a flight recorder over the drawing context. Armed, it keeps
every operation a frame issued, along with enough context state to draw that
frame on its own. What comes back is the build's own drawing rather than a
re-shoot of it, which is what makes a recording usable as evidence a reviewer
sees beside the same scenario driven against the reference implementation.

## A stable wrapper the game cannot escape

The rendering pipeline draws through a wrapper over the 2D context, built once
when the engine is constructed and kept for the engine's whole life. Every
built-in render component draws through it, and a `DrawComponent` receives it as
`DrawApi.ctx`, so the whole picture passes through the one wrapper. The wrapper
forwards every call and every assignment to the real context, so the pixels a
build draws are the same whether or not anything is being captured, and it
collects frames only while it is armed.

That holds for any value a build supplies. Encoding runs behind a guard wherever
the wrapper touches a value and carries the path it is walking, so a cyclic
object assigned to `fillStyle` records as an opaque marker and stays the silent
no-op a bare context makes of it. Whatever a build draws with, the wrapper
forwards it and the recorder keeps as much of it as it can encode.

Two bounds keep the encoding finite. The value an operation carries sits at
depth zero, and a container reached at depth 32 records as a marker rather than
being expanded. One encoded value also expands into at most 65,536 values,
because a depth bound alone does not bound the work: a shared graph twenty
levels deep is well inside the depth bound and expands to a million values,
since the format has no way to say "the same one again". Sharing is resolved
once and charged again wherever it is reached, and a container the expansion
bound falls inside carries its remainder as a single marker.

Both bounds are a fixed part of the format rather than a choice each recorder
makes. Two recorders write this format, the engine's and the one a validator
injects into an engineless build, and a bound they disagreed on would have them
answer the same drawing with two different documents.

The identity is stable because a build holds on to what it was given. A
`DrawComponent` that keeps the context it was handed on an earlier frame would
keep drawing through it, and a wrapper installed at the moment recording started
would be a different object from the one it kept. Arming is therefore a flag
inside one wrapper rather than a substitution of one context for another.

The engine's own frame preparation draws through the same wrapper as the
pipeline, so the clear, the viewport fit, and the camera projection are part of
the recording. A replayed frame starts from the blank, correctly transformed
page the original started from.

## Per-frame inherited state

A frame's own operations are not enough to draw it. A game that sets a font on
its first frame relies on the context still carrying that font a thousand frames
later, and a player that seeks straight to frame 900 has no earlier frame to
have inherited it from.

Each frame therefore names the context state it inherited, snapshotted before
the frame's first operation. Drawing a frame means restoring what it inherited
and replaying that frame's operations, and nothing else. Taking the snapshot at
the end of a frame instead would record the state the frame left behind, and
replay would draw the frame's opening operations under its closing style.

The state covers what survives a frame boundary: the style properties, the
transform, the dash pattern, the clip region, the current path, and the stack of
states saved under it. Reads are individually guarded, because the set of
properties a context carries differs between a browser and the native canvas a
[validator](/engines/structured-2d/validators/overview/) builds on. A property that
is absent is left out, which is the same outcome as a context that never had it.

### The save stack

A build is free to call `save` on one frame and `restore` on the next, so the
stack of saved states survives a frame boundary along with the state on top of
it. Each frame therefore names the states the context had saved when the frame
opened, outermost first, and a player pushes them onto the context before
applying the frame's own state. A `restore` among the frame's operations then
returns to the state the original returned to.

The stack holds at most 64 entries and the entries kept are the innermost ones,
because a `restore` pops the innermost first and those are the states a frame's
own operations can still reach. The bound is what keeps an unbalanced `save`
from costing a longer stack at every frame open for the rest of a recording, and
it is part of the format, so a player refuses a frame carrying a longer stack
rather than pushing a level per entry through a draw that freezes the reviewer's
tab.

### The clip region and the current path

A context reports every part of its state except the clip and the current path,
so the recorder shadows both. It keeps the path operations issued since the last
`beginPath` as the current path, and a `clip` call moves that path, together
with the clip call itself, onto the region already in force, because clips
intersect rather than replace. Each segment of either carries the transform that
was in force when its operations were issued, since a path is given in user
space, and a player replays each segment under its own transform before setting
the frame's.

A canvas keeps its current path across a frame boundary, so a build is free to
open a path on one frame and fill it on the next. Applying an inherited clip is
what makes carrying the path unavoidable: replaying a clip segment's path
operations leaves the clip outline current, so a frame that then issued a bare
`fill` would fill that outline. A player therefore issues `beginPath` between
the clip segments and the path segments, which is the same thing the original
context did when the build called `beginPath` itself.

The clip travels with the rest of the state through `save` and `restore`, and
`reset` clears it. The current path sits outside the saved state and survives
both. A player blanks the context before every frame, so a clip or a path
established on an earlier frame reaches a later one only by being part of what
that frame inherits.

Each holds at most 1024 path operations. Neither has a frame boundary to bound
it, and a build that never calls `beginPath` would otherwise accumulate
operations for the rest of the recording with every frame open re-encoding all
of them. The current path keeps the operations it already holds and refuses each
further one, so a frame inherits the prefix of the path the build built.

A `clip` call is carried whole or not at all, because half a clip path is a
region the build never had. It costs the whole of the path in force plus the
call itself, so it is refused when the region it would leave behind runs past
the bound, and refused when the path it would take is itself a prefix. The
region in force then stands as it is, and the frame inherits a region wider than
the one the build was drawing under.

A frame that inherits a save stack, a clip or a path the recorder had to cut
down says so, and a player reports it beside everything else it could not
reproduce. A reviewer has to be able to tell a picture the format could not
carry from one it carried.

### A canvas reset

Writing `canvas.width` or `canvas.height` resets the context: the transform
returns to the identity, the style properties return to their defaults, the clip
region is discarded, and the save stack is emptied. The engine synchronizes its
backing store to the display from inside the frame bracket, so a recording has
to survive one, and `canvas.width = canvas.width` is the ordinary way a build
clears its surface.

The recorder therefore detects a reset by watching the element rather than by
comparing sizes, which a reset that writes the same size back leaves unchanged.
It installs its own `width` and `height` accessors on the canvas, each
forwarding to the accessor it inherits and telling the recorder after the write.
The accessors go on only where the canvas inherits an accessor pair, and the
fallback is the backing store size, read before each shadowed operation and each
state snapshot.

A reset clears the save stack, the clip, and the current path, which are the
three things the recorder shadows. The rest of the state is read back from the
context itself and corrects itself. A reset inside a frame also discards the
operations that frame had already recorded, because the wipe erased the pixels
they drew, and the frame's inherited state is taken again against the context
the reset left.

## Independent frames make scrubbing parallel

Every frame is drawable on its own. A frame carries the whole of the state it
opened with: the style properties, the transform, the dash pattern, the clip
region, the current path, and the stack of saved states. The values its
operations draw with live in tables the whole recording shares, so an inherited
fill that is a gradient or a pattern resolves at whichever frame a player lands
on.

Seeking to a frame therefore costs what drawing that frame costs, and a player
jumps to frame 900 directly rather than replaying the 899 before it, which is
what makes a scrub bar responsive over a recording of any length.

Two properties of the canvas bound how exactly a frame drawn on its own
reproduces what was on screen at that moment. `putImageData` writes through the
clip, so pixels it wrote under a clip belong to no frame's state and no later
frame's clipped clear reaches them. A replay drawn from a single frame is
cleaner than the original was.

A clip whose edge falls between device pixels is antialiased, so a boundary
pixel is covered partly by what the frame paints and partly by what is already
there. The original shows the frame before it through that coverage and a seek
shows the background. Frame independence is exact for clips on whole device
pixels, and exact in every other respect.

The same property is what lets two recordings be scrubbed in step. A reviewer
moves one control and both the build's recording and the reference
implementation's are drawn at the frame that control names, with neither of them
having to be replayed from the beginning. The frame counter and the accumulated
simulated time travel with each frame, so the two are aligned on the figure the
engine stepped rather than on a wall clock.

## Values the context produced

Some of what a build draws with is created through the context and then mutated
through the object the context returned. A gradient is created by a call and
then given its color stops through the value that call handed back, so a
recorder watching only the context would record the creation and miss every
stop.

Four methods produce such a value: `createLinearGradient`,
`createRadialGradient`, `createConicGradient`, and `createPattern`. Each answer
is wrapped in turn, and the calls and assignments made on it are collected as
that value's recipe: the creating call, followed by the mutations applied to it.
A use of the value as an argument or as an assigned value records as a reference
into the recording's resource table, and replay rebuilds the value by re-issuing
the recipe against the context it is drawing into. The producing call belongs to
the recipe rather than to the frame, so every operation a frame holds is one the
context performed on itself.

The four are named rather than inferred because re-issuing a recipe is faithful
only for a value whose content is independent of the context's state. Everything
else a context call returns is carried as data: a `DOMMatrix` as the six numbers
`setTransform` accepts, an `ImageData` as a captured image, an array or a plain
object field by field, and anything beyond those as an opaque marker naming its
type. A build that reads its transform, changes it, and later puts the original
back therefore replays under the transform it drew with, and the lists
`getLineDash` and `getContextAttributes` answer stay out of the resource table.

The recipe is taken at the moment the value is used, carrying the mutations
applied so far, because a style property holds a live reference to what was
assigned to it. A gradient given another color stop after it was assigned to
`fillStyle` paints under that stop without ever being assigned again, so a
produced value is resolved as of the paint rather than as of the assignment. Two
uses with the same history are the same resource, and a value that is created
and never used is left out entirely.

Six calls paint through the style properties: `fill`, `stroke`, `fillRect`,
`strokeRect`, `fillText`, and `strokeText`. Resolving at the paint means the
recorder checks each style property holding a produced value before it records
one of them, against the encoding it last emitted for that property. A recipe
that has grown since then means the property paints something else now, so the
recorder records a corrective assignment first and what follows states what the
context is about to paint.

The record of what was last emitted travels with the state. A `save` copies it
onto the save stack and a `restore` puts back the copy taken at the matching
`save`, because a `restore` restores a reference rather than a copy and the
player's context returns to the encoding in force at that `save`. A `reset` or a
canvas reset empties the record, and an assignment of a value the context did
not produce drops the entry for that property.

A produced value is tracked from the moment the context creates it, armed or
not, because a build is free to create its gradients once at startup and fill
with them for the rest of its life. The mutation list a value carries is bounded
at 1024 steps, past which the value records as an opaque marker. A
`createPattern` handed a source it cannot use answers `null`, which produces
neither a resource nor an operation and travels as the `null` it is.

A recipe's arguments are as of the producing call rather than as of the use.
`createPattern` copies its source when it is called, so a pattern made from a
scratch canvas keeps the picture that canvas carried at that moment however
often the canvas is repainted afterwards. Encoding therefore runs in two stages:
a value is turned into a portable form when it is observed, at a producing call,
at a mutation step, or at an assignment, and that portable form is interned into
the running recording's tables when the value is used. Only the table indices
are deferred.

A produced value read back off the context comes back wrapped as well, because
`ctx.fillStyle` hands back the gradient the build assigned and a color stop
added through that read is a mutation like any other. Arguments cross the
wrapper unwrapped, because a native context refuses one of these wrappers where
it expects one of its own objects. The wrapping is therefore invisible to the
context and visible to the recorder, and a player reports the one operation it
cannot reproduce instead of drawing something else.

## Capturing what a build blits

A sprite-based build spends most of its operations on `drawImage`, so the
sources those calls draw from are part of the picture rather than something
beside it. Every bitmap source the recorder sees is drawn into a scratch canvas
and captured as a PNG data URL.

An `ImageData` handed to `putImageData` is captured as its raw RGBA bytes
instead. Drawing an image into a canvas premultiplies each color channel by the
pixel's alpha and reading the pixels back un-premultiplies them, so the round
trip a PNG needs quantizes a partially transparent pixel to eight bits twice and
returns a different color. Raw bytes are exact by construction and are rebuilt
without a decoder, and `ImageData` is the one kind of image a check compares
byte for byte.

A source is read before the call that draws it is issued, because a call can
change what its own argument holds. `ctx.drawImage(ctx.canvas, …)` is the
ordinary trails blit, and a source read after the blit is the surface the blit
left behind, which replays as the picture composited on top of itself.

A source whose content is fixed is keyed on its identity and encoded once, so
the sprite sheets a build loads at startup cost one entry each however many
frames blit from them. An image element is keyed together with the file it
points at and the size it was captured at, so re-pointing an `<img>` at another
file captures the new content. An `<img>` is captured at its natural size, and
an `<image>` in an SVG document reports no natural size and is captured at its
layout size, so a drawing that resizes one captures it again.

A source whose content can change is captured at every use, and entries are
shared whenever their bytes match. A canvas, an offscreen canvas, a video, a
video frame and an `ImageData` therefore cost one entry however many times they
are drawn while their content stands, and one entry per picture they were drawn
under. That is what an `ImageData` mutated between two `putImageData` calls in
the same frame is worth, and it is what lets a source whose bytes the recording
already holds keep resolving after the capture budget is reached.

Capture stops once a recording holds 16 MB of image bytes, counted over the
bytes the recording carries. Images already captured keep resolving, and a
further new capture records the opaque marker a player already reports. A build
that blits a full-screen offscreen canvas every frame would otherwise produce an
artifact of tens of megabytes, and a reviewer who cannot load a replay at all is
worse off than one looking at a replay that names the operation it left out.

A captured bitmap that fails to decode in a reviewer's browser resolves to
nothing, and an operation naming it is skipped and reported alongside the opaque
ones, so a replay accounts for every operation it leaves out. A pixel buffer has
no decoder in the way and three failures of its own: bytes that are not base64,
a byte count disagreeing with the size the entry declares, and a host with no
`ImageData` to hold the result. Each is refused and reported the same way.

## Nine significant digits

Every number a recording carries as part of the drawing is written to at most
nine significant digits. That resolves to about a millionth of a pixel over a
design space of a thousand-odd units, so the digits past it describe the
arithmetic that produced a coordinate rather than the picture that coordinate
draws, while a full double expansion of a physics position costs seventeen
characters per number across every operation of every frame.

The frame metadata is exact. The frame counter, the accumulated simulated time,
the delta, and the backing store size are the axis a reviewer scrubs on and the
figures a check asserts against, so they are carried as the engine reported
them.

## One copy of each operation

Consecutive frames of a game issue very nearly the same operations, and a
sprite-based build issues the identical call every frame for as long as a sprite
sits still. A recording therefore holds each distinct operation once and each
distinct inherited state block once, and a frame names its state by index and
its operations by an array of indices. Images and resources are shared the same
way, on their bytes and on their recipes.

Sharing is keyed on the entry itself, written canonically so that two equal
entries compare equal whatever order their fields were produced in. A reviewer's
browser parses and holds the whole document, so holding each entry once bounds
what a replay costs to load as well as what it costs to store.

The tables are settled when the recording is closed, from the frames it holds,
so every entry is one some frame names. A canvas wiped part-way through a frame
discards the operations the wipe erased, and the entries those operations alone
named go with them.

## The frame bracket excludes the diagnostics overlay

A frame opens before the engine prepares the canvas and closes after the
[pipeline](/engines/structured-2d/concepts/rendering/) has drawn, which leaves
the [diagnostics](/engines/structured-2d/concepts/diagnostics/) overlay outside
it. The overlay is chrome drawn over the finished picture, in device pixels with
the transform reset, and baking a debug panel into a reviewer's evidence would
misreport what the build drew.

The collision overlay is inside the bracket. It is a render switch, drawn by the
pipeline as the last part of the picture, so a recording taken with the switch
on carries every collider's shape over the drawing, in the same frame that drew
it. A reviewer who wants the build's picture alone records with the switch off.

The bracket is also what makes arming cheap to reason about. Capture begins at
the next frame, so a caller that arms the recorder mid-frame gets whole frames
rather than a frame whose clear and transform had already happened. A frame
still open when the recorder is disarmed is dropped, because the recording it
would have joined has already been handed to its caller.

## Armed around a section, idle otherwise

The recorder is armed and disarmed by whoever owns the engine, so a check
records the section of a scenario it is about and pays nothing for the setup
that got there. While it is idle the wrapper costs one property lookup and one
call per operation, and it keeps four shadows: the recipe of each value the
context produced, the stack of saved states, the clip region in force, and the
current path. A frame inherits all four and a build establishes them long before
a caller arms the recorder, so they are maintained whenever the wrapper exists.

Each of the four is bounded. A recipe holds 1024 mutation steps, the save stack
holds 64 entries, and the clip and the current path hold 1024 path operations
each. A `beginPath` replaces the current path, and `reset` or a canvas reset
clears the clip and the path together. An engine that is never asked to record
therefore holds what its own gradients, clip, and path are worth, and nothing
per frame.

A recording holds what was drawn through the context the pipeline draws through.
A `DrawComponent` that draws to a surface of its own is drawing outside the
recording, and a frame that emits no operations while its pixels change is the
signal that it did.
