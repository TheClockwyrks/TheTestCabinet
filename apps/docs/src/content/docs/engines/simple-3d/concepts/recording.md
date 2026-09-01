---
title: Recording
---

The engine carries a flight recorder over the scene and the screen layer.
Armed, it keeps what every frame submitted to be drawn: the scene as the game
left it after `render`, as draws, lights, and a camera, and every operation the
game issued against the screen layer's context, along with enough state to draw
that frame on its own. What comes back is the build's own picture rather than a
re-shoot of it, which is what makes a recording usable as evidence a reviewer
sees beside the same scenario driven against the reference implementation.

## The scene as submitted, not as rendered

A recording holds what the game handed the renderer rather than the pixels the
renderer produced. After `render` returns, the engine updates world matrices and
walks the scene, keeping each mesh, instanced mesh, skinned mesh, line, and
point cloud that is visible with every ancestor visible and whose layers
intersect the camera's, in traversal order with its world matrix, its material,
and its render order. The camera is read at the same moment, after the game has
posed it, and each light is kept with its world position and direction. A
player rebuilds those objects and renders them through three, so the sorting
and the shading that placed the original picture place the replay.

Frustum culling is the renderer's own optimization and changes no picture, so
the recorder ignores it and a culled object is recorded like any other. Reading
the scene rather than the renderer is also what makes capture independent of a
renderer existing: under the `headless` backend the same walk produces the same
frame, which is why a validator's recording matches a browser's frame for
frame.

A kind of object the format does not carry, a light of a kind it does not
carry, a material map the recorder could not capture, and a geometry past the
attribute budget are each left out, and the frame says so. A player reports the
flag beside everything else it could not reproduce, because a reviewer has to
be able to tell a picture the format could not carry from one it carried.

## Geometry once, keyed on its version

A game builds its geometries once and draws them for the rest of its life, so
a recording holds each distinct geometry once and a draw names it by index. A
geometry is keyed on its identity together with the `version` of each of its
attributes, which is the signal three itself uses to re-upload a buffer, so a
static mesh costs one entry however many frames draw it and a geometry a build
rewrites costs one entry per version drawn.

Attribute bytes are carried exactly, because a decoded geometry has to be the
geometry the renderer drew and a mesh's vertices are the picture rather than
arithmetic beside it. Capture stops once a recording holds 64 MB of attribute
bytes. Geometries already captured keep resolving, and a draw needing a further
new geometry is left out with the frame marked, so a build that regenerates a
large mesh every frame produces a recording a reviewer can load rather than one
of hundreds of megabytes.

A material is keyed on its recorded fields, so two materials that draw the same
way are one entry, and a class outside the kinds the format names records as
opaque with its constructor name and whatever of color, opacity, transparency,
and side it carries. A player draws it as a basic material and reports it, which
is the same degradation the screen layer applies to a value it cannot carry.

## Poses travel with the draw

A skinned mesh records its rest geometry once, and each draw of it carries the
skeleton's bone matrices for that frame together with its bind matrix. A player
feeds the same matrices to the same skinning the renderer performs, so an
animated model replays through the pose the game reached on that frame without
the recording carrying the animation, the mixer, or the clip. An instanced mesh
records one draw carrying every instance matrix, which is what its one draw
call was worth.

A draw, a light, and a camera are each keyed on their recorded fields and held
once, in the same tables the screen layer shares its operations through. An
object that sits still under one material costs one entry across every frame
that draws it, and a fixed camera and lighting rig cost one entry each for the
whole recording.

## A stable wrapper the game cannot escape

The engine hands `render` its screen layer through a wrapper over the layer's
2D context, built once when the engine is constructed and handed out for the
engine's whole life. The wrapper forwards every call and every assignment to
the real context, so the pixels a build draws are the same whether or not
anything is being captured, and it collects frames only while it is armed.

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
makes. The screen layer is recorded by the same wrapper the 2D engines record
their context with, and a validator injects the same one over a context of its
own, so a bound they disagreed on would have them answer the same drawing with
two different documents.

The identity is stable because a game holds on to what it was given. A wrapper
installed at the moment recording started would be a different object from the
one a game captured on an earlier frame, and that game would keep drawing
through the context it already held. Arming is therefore a flag inside one
wrapper rather than a substitution of one context for another.

The engine's own frame preparation draws through the same wrapper as the game's
`render`, so the screen layer's clear and viewport transform are part of the
recording. A replayed frame starts from the blank, correctly transformed layer
the original started from.

## Per-frame inherited state

A frame's own screen operations are not enough to draw its layer. A game that
sets a font on its first frame relies on the context still carrying that font a
thousand frames later, and a player that seeks straight to frame 900 has no
earlier frame to have inherited it from.

Each frame therefore names the context state its screen layer inherited,
snapshotted before the frame's first operation. Drawing the layer means
restoring what it inherited and replaying that frame's operations, and nothing
else. Taking the snapshot at the end of a frame instead would record the state
the frame left behind, and replay would draw the frame's opening operations
under its closing style.

The state covers what survives a frame boundary: the style properties, the
transform, the dash pattern, the clip region, the current path, and the stack of
states saved under it. Reads are individually guarded, because the set of
properties a context carries differs between a browser and the native canvas a
[validator](/engines/simple-3d/validators/overview/) supplies as the screen
layer. A property that is absent is left out, which is the same outcome as a
context that never had it.

The scene needs no inherited state. A frame carries its camera, its lights, and
every draw as submitted, and a three object holds its own transform and
material, so nothing a frame's scene depends on was established by an earlier
frame.

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
both. A player blanks the layer before every frame, so a clip or a path
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

A frame whose layer inherits a save stack, a clip or a path the recorder had to
cut down says so on its screen part, separately from the scene's own flag, and
a player reports both beside everything else it could not reproduce.

### A canvas reset

Writing the screen canvas's `width` or `height` resets its context: the
transform returns to the identity, the style properties return to their
defaults, the clip region is discarded, and the save stack is emptied. The
engine synchronizes the screen layer's backing store to the stage canvas's from
inside the frame bracket, so a recording has to survive one, and
`screen.canvas.width = screen.canvas.width` is the ordinary way a build wipes
the layer.

The recorder therefore detects a reset by watching the element rather than by
comparing sizes, which a reset that writes the same size back leaves unchanged.
It installs its own `width` and `height` accessors on the screen canvas, each
forwarding to the accessor it inherits and telling the recorder after the
write. The accessors go on only where the canvas inherits an accessor pair, and
the fallback is the backing store size, read before each shadowed operation and
each state snapshot.

A reset clears the save stack, the clip, and the current path, which are the
three things the recorder shadows. The rest of the state is read back from the
context itself and corrects itself. A reset inside a frame also discards the
screen operations that frame had already recorded, because the wipe erased the
pixels they drew, and the frame's inherited state is taken again against the
context the reset left. The frame's scene is untouched by it, because the scene
is captured from the scene object rather than from the layer.

## Independent frames make scrubbing parallel

Every frame is drawable on its own. A frame carries its camera, its lights, and
every draw as submitted, and its screen part carries the whole of the state it
opened with: the style properties, the transform, the dash pattern, the clip
region, the current path, and the stack of saved states. The geometries,
materials, images, and resources a frame draws with live in tables the whole
recording shares, so a mesh uploaded on the first frame and a gradient inherited
from the tenth both resolve at whichever frame a player lands on.

Seeking to a frame therefore costs what drawing that frame costs, and a player
jumps to frame 900 directly rather than replaying the 899 before it, which is
what makes a scrub bar responsive over a recording of any length. A decoded
geometry and material are reused across frames of the same recording, so the
decode is paid once and a seek pays for the draw.

The scene half of a frame is exact: its draws describe the same objects under
the same matrices the renderer was handed, and three sorts and shades them by
the same rules. Two properties of the screen layer's canvas bound how exactly
the layer reproduces what was on screen at that moment. `putImageData` writes
through the clip, so pixels it wrote under a clip belong to no frame's state
and no later frame's clipped clear reaches them, and a replay drawn from a
single frame is cleaner than the original was.

A clip whose edge falls between device pixels is antialiased, so a boundary
pixel is covered partly by what the frame paints and partly by what is already
there. The original shows the frame before it through that coverage and a seek
shows the picture beneath. Frame independence is exact for clips on whole device
pixels, and exact in every other respect.

The same property is what lets two recordings be scrubbed in step. A reviewer
moves one control and both the build's recording and the reference
implementation's are drawn at the frame that control names, with neither of them
having to be replayed from the beginning. The frame counter and the accumulated
simulated time travel with each frame, so the two are aligned on the figure the
engine stepped rather than on a wall clock.

## Values the context produced

Some of what a build draws on the screen layer with is created through the
context and then mutated through the object the context returned. A gradient is
created by a call and then given its color stops through the value that call
handed back, so a recorder watching only the context would record the creation
and miss every stop.

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
`screen.fillStyle` hands back the gradient the build assigned and a color stop
added through that read is a mutation like any other. Arguments cross the
wrapper unwrapped, because a native context refuses one of these wrappers where
it expects one of its own objects. The wrapping is therefore invisible to the
context and visible to the recorder, and a player reports the one operation it
cannot reproduce instead of drawing something else.

## Capturing what a build blits and maps

A HUD spends most of its screen operations on `drawImage` and `fillText`, and
a textured scene draws through its material maps, so the sources those draw
from are part of the picture rather than something beside it. Every bitmap
source the recorder sees on the screen layer is drawn into a scratch canvas and
captured as a PNG data URL, and a material's map is captured the same way from
the texture's source image, into the same table and against the same budget.

An `ImageData` handed to `putImageData` is captured as its raw RGBA bytes
instead. Drawing an image into a canvas premultiplies each color channel by the
pixel's alpha and reading the pixels back un-premultiplies them, so the round
trip a PNG needs quantizes a partially transparent pixel to eight bits twice and
returns a different color. Raw bytes are exact by construction and are rebuilt
without a decoder, and `ImageData` is the one kind of image a check compares
byte for byte.

A source is read before the call that draws it is issued, because a call can
change what its own argument holds. `screen.drawImage(screen.canvas, …)` is the
ordinary trails blit, and a source read after the blit is the surface the blit
left behind, which replays as the picture composited on top of itself.

A source whose content is fixed is keyed on its identity and encoded once, so
the sprite sheets a build loads at startup and the textures `loadTexture`
decodes cost one entry each however many frames blit or sample from them. An
image element is keyed together with the file it points at and the size it was
captured at, so re-pointing an `<img>` at another file captures the new
content. An `<img>` is captured at its natural size, and an `<image>` in an SVG
document reports no natural size and is captured at its layout size, so a
drawing that resizes one captures it again.

A source whose content can change is captured at every use, and entries are
shared whenever their bytes match. A canvas, an offscreen canvas, a video, a
video frame and an `ImageData` therefore cost one entry however many times they
are drawn while their content stands, and one entry per picture they were drawn
under. That is what an `ImageData` mutated between two `putImageData` calls in
the same frame is worth, it is what a texture over a canvas a build repaints
costs, and it is what lets a source whose bytes the recording already holds
keep resolving after the capture budget is reached.

Capture stops once a recording holds 16 MB of image bytes, counted over the
bytes the recording carries, maps and screen sources together. Images already
captured keep resolving; a further new screen capture records the opaque marker
a player already reports, and a further new map is left off its material with
the frame marked. A build that blits a full-screen offscreen canvas every frame
would otherwise produce an artifact of tens of megabytes, and a reviewer who
cannot load a replay at all is worse off than one looking at a replay that
names what it left out.

A captured bitmap that fails to decode in a reviewer's browser resolves to
nothing. A screen operation naming it is skipped and reported alongside the
opaque ones, and a material naming it draws without its map and is reported, so
a replay accounts for everything it leaves out. A pixel buffer has no decoder
in the way and three failures of its own: bytes that are not base64, a byte
count disagreeing with the size the entry declares, and a host with no
`ImageData` to hold the result. Each is refused and reported the same way, as is
a geometry attribute whose byte count disagrees with its vertex count.

## Nine significant digits

Every number a recording carries as part of the drawing, outside an attribute
buffer, is written to at most nine significant digits: every matrix, position,
direction, and material scalar in the scene, and every coordinate, transform,
and dash in the screen layer. That resolves to about a millionth of a pixel
over a design space of a thousand-odd units, so the digits past it describe the
arithmetic that produced a coordinate rather than the picture that coordinate
draws, while a full double expansion of a physics position costs seventeen
characters per number across every matrix of every frame.

Attribute buffers are outside the rounding and carried byte for byte, because a
mesh's vertices are the picture and a rounded vertex is a different mesh. The
frame metadata is exact. The frame counter, the accumulated simulated time, the
delta, and the backing store size are the axis a reviewer scrubs on and the
figures a check asserts against, so they are carried as the engine reported
them.

## One copy of each entry

Consecutive frames of a game submit very nearly the same scene and issue very
nearly the same screen operations, and a build submits the identical draw
every frame for as long as an object sits still. A recording therefore holds
each distinct draw, light, camera, geometry, and material once, each distinct
screen operation once, and each distinct inherited state block once, and a
frame names its camera by index and its lights, draws, and operations by arrays
of indices. Images and resources are shared the same way, on their bytes and on
their recipes.

Sharing is keyed on the entry itself, written canonically so that two equal
entries compare equal whatever order their fields were produced in. A reviewer's
browser parses and holds the whole document, so holding each entry once bounds
what a replay costs to load as well as what it costs to store.

The tables are settled when the recording is closed, from the frames it holds,
so every entry is one some frame names. A screen layer wiped part-way through a
frame discards the operations the wipe erased, and the entries those operations
alone named go with them.

## The frame bracket excludes the overlay

A frame opens before the engine prepares the two canvases and closes after the
scene has been captured and the game's drawing on the screen layer has ended,
which leaves the [diagnostics](/engines/simple-3d/concepts/diagnostics/)
overlay outside it. The overlay is chrome drawn over the finished picture, on
the screen layer in device pixels with the transform reset, and baking a debug
panel into a reviewer's evidence would misreport what the build drew.

The scene is captured inside the bracket and before the renderer runs, so the
recording and the picture are read from the same scene at the same moment, and
the renderer's absence under `headless` changes nothing the bracket holds.

The bracket is also what makes arming cheap to reason about. Capture begins at
the next frame, so a caller that arms the recorder mid-frame gets whole frames
rather than a frame whose clear and transform had already happened. A frame
still open when the recorder is disarmed is dropped, because the recording it
would have joined has already been handed to its caller.

## Armed around a section, idle otherwise

The recorder is armed and disarmed by whoever owns the engine, so a check
records the section of a scenario it is about and pays nothing for the setup
that got there. While it is idle the scene is not walked, and the screen
wrapper costs one property lookup and one call per operation and keeps four
shadows: the recipe of each value the context produced, the stack of saved
states, the clip region in force, and the current path. A frame's screen part
inherits all four and a build establishes them long before a caller arms the
recorder, so they are maintained whenever the wrapper exists.

Each of the four is bounded. A recipe holds 1024 mutation steps, the save stack
holds 64 entries, and the clip and the current path hold 1024 path operations
each. A `beginPath` replaces the current path, and `reset` or a canvas reset
clears the clip and the path together. An engine that is never asked to record
therefore holds what its own gradients, clip, and path are worth, and nothing
per frame.

A recording holds what the build placed in the scene the engine renders and
drew through the screen context the engine handed it. A build that renders
through a renderer of its own or draws to a surface of its own is drawing
outside the recording, and a frame that submits no draws and emits no
operations while its pixels change is the signal that it did.
