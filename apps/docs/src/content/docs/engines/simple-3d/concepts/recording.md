---
title: Recording
---

The engine carries a flight recorder over the scene and the screen layer.
Armed, it keeps what every frame submitted to be drawn: the scene as the game
left it after `render`, as draws, lights, scene settings, and a camera, and
every operation the game issued against the screen layer's context, along with
enough state to draw that frame on its own. What comes back is the build's own
picture rather than a re-shoot of it, which a reviewer sees beside the same
scenario driven against the reference implementation.

A recording is an archive. A small JSON document holds tables of references and
scalars, two binary buffers hold the matrices and the embedded geometry the
frames name by span, and every asset the build loaded travels once under the
hash of its bytes. The [API page](/engines/simple-3d/apis/recording/) fixes
the tables and the archive entries; this page explains the shape.

## The scene as submitted

A recording holds what the game handed the renderer rather than the pixels the
renderer produced. After `render` returns, the engine updates world matrices and
walks the scene, keeping each mesh, instanced mesh, skinned mesh, line, line
segments, line loop, point cloud, and sprite that is visible with every ancestor
visible and whose layers intersect the camera's, in traversal order with its
world matrix, its material, and its render order. The scene's background, fog,
and environment, the camera, and each light's world position and direction are
read at the same moment, after the game has posed the camera. A player rebuilds
those objects and renders them through three, so the sorting and the shading
that placed the original picture place the replay.

Frustum culling is the renderer's own optimization and changes no picture, so
the recorder ignores it and a culled object is recorded like any other. Reading
the scene rather than the renderer is also what makes capture independent of a
renderer existing: under the `headless` backend the same walk produces the same
frame, which is why a validator's recording matches a browser's frame for
frame.

## Referenced assets and embedded content

Most of what a textured 3D game draws with came through the asset loader, so a
recording refers to those files rather than carrying their contents again. The
loader keeps a registry of every file it resolved: its path, the SHA-256 of its
bytes, the bytes themselves, and the identity of every three object decoded
from it, each primitive's geometry by glTF mesh and primitive index and each
texture's source image by glTF image index, or as the file itself for a texture
loaded on its own. A draw whose geometry the registry knows records a reference
to the asset and the primitive, a texture whose image it knows records a
reference to the asset and the image, and the file travels in the archive once
under its hash. `cloneModel` shares geometries and images with its template, so
every placed copy of a model resolves to the same entry.

A geometry the registry does not know is embedded: one built from a three
primitive constructor, computed in code, or assembled by hand. The recorder
keeps a cache keyed on the geometry object's identity together with the
identity and `version` of each attribute and of the index, and the draw range,
so a static mesh is encoded once however many frames draw it. A fresh attribute
installed with `setAttribute` or `setIndex` is a new identity and is captured,
as is an attribute whose `version` advanced through `needsUpdate`, which is the
same signal three uses to re-upload a buffer. A cache miss encodes the
attribute bytes and the entry is shared on those bytes, so two identical
procedural geometries, two `new BoxGeometry(1, 1, 1)` for one, are one entry.

An embedded geometry carries its draw range and its morph targets beside its
attributes. The range is three's `drawRange`, so a build that draws a growing
prefix of one buffer costs an entry per range rather than a copy of the buffer
per frame. Each morph target's position attribute, and its normal attribute
when it has one, travels with the geometry in target order, and the influences
that pose the targets on a given frame travel with the draw. A skinned mesh
records its rest geometry once, and its bone and bind matrices travel with the
draw as well.

An image the registry does not know is embedded the same way. A canvas the
build draws into, a `DataTexture`, or an `ImageBitmap` the build made itself is
encoded as a PNG entry of the archive, keyed on its source's identity together
with the texture's `version`, and entries are shared on their PNG bytes, so a
fixed canvas texture costs one map and a repainted one costs a map per distinct
picture. A texture is keyed on its image reference together with its repeat,
offset, rotation, wrap modes, flip, and color space, and a material on its kind,
its scalars, and the textures in its seven slots, so two materials that draw
the same way are one entry.

A sprite records with no geometry, since its quad belongs to the renderer: the
draw carries its center, and its material records as the `sprite` kind with its
map, color, opacity, transparency, rotation, size attenuation, and depth test
and write. A material class outside the kinds the format names records as
`opaque` with its constructor name and whatever of color, opacity, transparency,
and side it carries. A player draws it as a basic material and reports it, which
is the same degradation the screen layer applies to a value it cannot carry.

## Poses travel with the draw

A draw carries the object's world matrix, and everything else that changes from
frame to frame without changing the object, as spans into the frames buffer. A
skinned mesh's draw carries the skeleton's bone matrices for that frame together
with its bind matrix, and a player feeds the same matrices to the same skinning
the renderer performs, so an animated model replays through the pose the game
reached on that frame without the recording carrying the animation, the mixer,
or the clip. An instanced mesh records one draw carrying every instance matrix,
and its instance colors when it has them, which is what its one draw call was
worth. An object with morph targets carries its influences, one per target.

A span is shared on the bytes it names, and a draw, a light, a camera, and a
scene entry are each keyed on their recorded fields and held once. An object
that sits still under one material therefore costs one span and one draw entry
across every frame that draws it, and a fixed camera, scene setting, and
lighting rig cost one entry each for the whole recording. What grows with a
recording is the poses: each new world matrix of a moving object is a new span,
and the draw naming it is a new entry.

## The archive and its buffers

The on-disk form of a recording is a zip archive with the extension `.replay`,
and `packRecording` builds it from what `stopRecording` returns. The document,
`recording.json`, is the one deflated entry. It holds the tables, the frames,
and the indices and spans that tie them together, so it stays small however
long the recording runs. Two buffers hold what the document only points at:
`frames.bin` holds every matrix and influence the scene half carries per frame,
and `geometry.bin` holds the attributes of every embedded geometry, both
little-endian and stored as they are, so a player views them in place.

The remaining entries are files. Each embedded image is a `maps/<n>.png` entry,
and each referenced asset is an `assets/<sha256>` entry holding the file byte
for byte, so a player decodes it with the decoder the engine used and takes the
primitive or image a reference names. A `.gltf` that names external buffers or
images travels together with every file the decoder fetched through it, each
under its own hash, and a player resolves the URIs relative to the model's path
against the assets table. A player opens the archive once, holds the buffers
and entries as bytes, and decodes each asset, embedded geometry, and map on the
first frame that needs it, keeping the result for the rest of the recording.

A player checks what it opens. An asset whose bytes fail their hash or fail to
decode resolves to nothing, and every draw and texture naming it is skipped and
reported. A span past its buffer, an attribute span disagreeing with its vertex
count and width, and a draw span disagreeing with its matrix count are each
refused, and the draw naming one is skipped and reported. A map that fails to
decode leaves its slot unset, and the material naming it is reported.

## The scene is a projection

The scene half of a frame is a projection of the three scene onto the format's
tables: the eight renderable classes, the geometry attributes an embedded
geometry lists, the material kinds and the seven texture slots, the five light
kinds, the two camera classes, and a scene's background, fog, and environment.
A player rebuilds what those tables carry, and three sorts and shades the
result by its own rules, so a picture made of those parts replays as the
renderer drew it.

What lies outside the tables is dropped, and a player reports it: shadows,
materials outside the named kinds, which travel as `opaque` and draw as basic,
lights outside the five kinds, renderables outside the eight classes, and
post-processing. A frame that lost an object carries a flag, and an `opaque`
material is reported per entry, so every gap between the recording and the
original picture is named where it occurred. A reviewer reads an unshadowed
replay of a shadowed scene as a limit of the format rather than as something
the build failed to draw.

## A budget ends the recording, a coverage gap flags the frame

Two different things can go wrong during capture, and they are treated
differently. Four budgets bound the archive, each counted over the bytes it
will hold: 16 MB of embedded geometry, 16 MB of embedded maps, 64 MB of frames,
and 128 MB of referenced assets, an asset being charged at the first frame that
references it. When a frame would take the recording past any of them, that
frame is not recorded and neither is any later one, so every frame a recording
holds is whole. The document carries an `ended` mark naming the engine frame
counter of the first frame not held and the budget it hit, the recorder stays
armed until `stopRecording`, and a player shows where and why the recording
ended.

Ending the recording whole is what keeps a budgeted recording usable as
evidence. A frame missing some of its draws would replay as a picture the build
never drew, while a recording that stops at frame 700 of 900 shows 700 frames
the build drew and says why the rest are absent.

A coverage gap flags the frame instead. A renderable of a class the format does
not carry, a light of a class it does not carry, a mesh with a material array,
a geometry attribute of a type or width the format does not carry, and a
texture image the recorder could not encode are each left out, and the frame's
scene part says so. A single flag stands for however many, and a player reports
it beside everything else it could not reproduce, because a reviewer has to be
able to tell a picture the format could not carry from one it carried.

The screen layer keeps the 2D contract's own treatment. Its bitmaps and pixel
buffers have a 16 MB budget of their own, and a capture past it records the
opaque marker a player already reports, which degrades the one operation rather
than ending the recording, because the shared 2D wrapper owns the layer.

## One wrapper for the engine's life

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
counted over every value the walk reaches, with sharing resolved once and
charged again wherever it is reached, and a container the expansion bound falls
inside carries its remainder as a single marker. Both bounds are a fixed part of
the format, because the screen layer is recorded by the same wrapper the 2D
engines record their context with.

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

The scene needs no inherited state. A frame carries its scene entry, its
camera, its lights, and every draw as submitted, and a three object holds its
own transform and material, so nothing a frame's scene depends on was
established by an earlier frame.

### The save stack

A build is free to call `save` on one frame and `restore` on the next, so the
stack of saved states survives a frame boundary along with the state on top of
it. Each frame therefore names the states the context had saved when the frame
opened, outermost first, and a player pushes them onto the context before
applying the frame's own state. A `restore` among the frame's operations then
returns to the state the original returned to.

The stack holds at most 64 entries and the entries kept are the innermost ones,
because a `restore` pops the innermost first and those are the states a frame's
own operations can still reach. The bound keeps an unbalanced `save` from
costing a longer stack at every frame open for the rest of a recording, and it
is part of the format, so a player refuses a frame carrying a longer stack.

### The clip region and the current path

A context reports every part of its state except the clip and the current path,
so the recorder shadows both. It keeps the path operations issued since the last
`beginPath` as the current path, and a `clip` call moves that path, together
with the clip call itself, onto the region already in force, because clips
intersect. Each segment of either carries the transform that was in force when
its operations were issued, since a path is given in user space, and a player
replays each segment under its own transform before setting the frame's.

A canvas keeps its current path across a frame boundary, so a build is free to
open a path on one frame and fill it on the next. Applying an inherited clip is
what makes carrying the path unavoidable: replaying a clip segment's path
operations leaves the clip outline current, so a frame that then issued a bare
`fill` would fill that outline. A player therefore issues `beginPath` between
the clip segments and the path segments.

The clip travels with the rest of the state through `save` and `restore`, and
`reset` clears it. The current path sits outside the saved state and survives
both. A player blanks the layer before every frame, so a clip or a path
established on an earlier frame reaches a later one only by being part of what
that frame inherits.

Each holds at most 1024 path operations, since neither has a frame boundary to
bound it. The current path keeps the operations it already holds and refuses
each further one, so a frame inherits the prefix of the path the build built. A
`clip` call is carried whole or not at all, because half a clip path is a region
the build never had: it costs the whole of the path in force plus the call
itself, and is refused when the region it would leave behind runs past the
bound or when the path it would take is itself a prefix. The region in force
then stands as it is, and the frame inherits a region wider than the one the
build was drawing under.

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

The recorder therefore detects a reset by watching the element, since a reset
that writes the same size back leaves the size unchanged. It installs its own
`width` and `height` accessors on the screen canvas, each forwarding to the
accessor it inherits and telling the recorder after the write. The accessors go
on only where the canvas inherits an accessor pair, and the fallback is the
backing store size, read before each shadowed operation and each state
snapshot.

A reset clears the save stack, the clip, and the current path, which are the
three things the recorder shadows. The rest of the state is read back from the
context itself and corrects itself. A reset inside a frame also discards the
screen operations that frame had already recorded, because the wipe erased the
pixels they drew, and the frame's inherited state is taken again against the
context the reset left. The frame's scene is untouched by it, because the scene
is captured from the scene object rather than from the layer.

## Independent frames make seeking direct

Every frame is drawable on its own. A frame carries its scene entry, its
camera, its lights, and every draw as submitted, and its screen part carries
the whole of the state it opened with: the style properties, the transform, the
dash pattern, the clip region, the current path, and the stack of saved states.
The geometries, materials, textures, assets, images, and resources a frame
draws with live in tables the whole recording shares, so a model loaded before
the first frame and a gradient inherited from the tenth both resolve at
whichever frame a player lands on.

Seeking to a frame therefore costs what drawing that frame costs, and a player
jumps to frame 900 directly rather than replaying the 899 before it, which is
what makes a scrub bar responsive over a recording of any length. A decoded
asset, geometry, map, and material are reused across frames of the same
recording, so the decode is paid once and a seek pays for the draw.

The scene half of a frame reproduces what the tables carry and reports what
they drop, as given under [the scene is a
projection](#the-scene-is-a-projection). Two properties of the screen layer's
canvas bound how closely the layer reproduces what was on screen at that
moment. `putImageData` writes through the clip, so pixels it wrote under a clip
belong to no frame's state and no later frame's clipped clear reaches them, and
a replay drawn from a single frame is cleaner than the original was.

A clip whose edge falls between device pixels is antialiased, so a boundary
pixel is covered partly by what the frame paints and partly by what is already
there. The original shows the frame before it through that coverage and a seek
shows the picture beneath. Frame independence holds for clips on whole device
pixels, and in every other respect of the screen layer.

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
back therefore replays under the transform it drew with.

The recipe is taken at the moment the value is used, carrying the mutations
applied so far, because a style property holds a live reference to what was
assigned to it. A gradient given another color stop after it was assigned to
`fillStyle` paints under that stop without ever being assigned again, so a
produced value is resolved as of the paint rather than as of the assignment. Two
uses with the same history are the same resource, and a value that is created
and never used is left out entirely.

Six calls paint through the style properties: `fill`, `stroke`, `fillRect`,
`strokeRect`, `fillText`, and `strokeText`. Before recording one of them, the
recorder checks each style property holding a produced value against the
encoding it last emitted for that property. A recipe that has grown since then
means the property paints something else now, so the recorder records a
corrective assignment first and what follows states what the context is about
to paint.

The record of what was last emitted travels with the state. A `save` copies it
onto the save stack and a `restore` puts back the copy taken at the matching
`save`, so a paint after a restore is measured against the encoding in force at
that `save`. A `reset` or a canvas reset empties the record, and an assignment
of a value the context did not produce drops the entry for that property.

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

## Capturing what a build blits

A HUD spends most of its screen operations on `drawImage` and `fillText`, so
the sources those draw from are part of the picture rather than something
beside it. Every bitmap source the recorder sees on the screen layer is drawn
into a scratch canvas and captured as a PNG data URL in the screen layer's own
image table, inside the document. Material images take a different route, as
asset references and PNG entries of the archive, and belong to the scene's
texture table.

An `ImageData` handed to `putImageData` is captured as its raw RGBA bytes
instead. Drawing an image into a canvas premultiplies each color channel by the
pixel's alpha and reading the pixels back un-premultiplies them, so the round
trip a PNG needs quantizes a partially transparent pixel to eight bits twice and
returns a different color. Raw bytes are rebuilt without a decoder, and
`ImageData` is the one kind of image a check compares byte for byte.

A source is read before the call that draws it is issued, because a call can
change what its own argument holds. `screen.drawImage(screen.canvas, …)` is the
ordinary trails blit, and a source read after the blit is the surface the blit
left behind, which replays as the picture composited on top of itself.

A source whose content is fixed is keyed on its identity and encoded once, so
the sprite sheets a build blits from cost one entry each however many frames
draw them. An image element is keyed together with the file it points at and
the size it was captured at, so re-pointing an `<img>` at another file captures
the new content. An `<img>` is captured at its natural size, and an `<image>`
in an SVG document reports no natural size and is captured at its layout size,
so a drawing that resizes one captures it again.

A source whose content can change is captured at every use, and entries are
shared whenever their bytes match. A canvas, an offscreen canvas, a video, a
video frame and an `ImageData` therefore cost one entry however many times they
are drawn while their content stands, and one entry per picture they were drawn
under. That is what an `ImageData` mutated between two `putImageData` calls in
the same frame is worth, and it is what lets a source whose bytes the recording
already holds keep resolving after the capture budget is reached.

Capture stops once the screen layer's table holds 16 MB of image bytes, counted
over the bytes the recording carries. Images already captured keep resolving,
and a further new capture records the opaque marker a player already reports.

A captured bitmap that fails to decode in a reviewer's browser resolves to
nothing, and a screen operation naming it is skipped and reported alongside the
opaque ones. A pixel buffer has no decoder in the way and three failures of its
own: bytes that are not base64, a byte count disagreeing with the size the entry
declares, and a host with no `ImageData` to hold the result. Each is refused and
reported the same way.

## Nine significant digits

Every number the document carries is written to at most nine significant
digits: every position, direction, scalar, and camera matrix in the scene
tables, and every coordinate, transform, and dash in the screen layer. That
resolves to about a millionth of a pixel over a design space of a thousand-odd
units, so the digits past it describe the arithmetic that produced a coordinate
rather than the picture that coordinate draws.

The buffers are outside the rounding. Everything in the frames buffer and the
geometry buffer is float32 or an unsigned integer as uploaded, so a draw's
world matrix, a bone matrix, and a mesh's vertices are the values the renderer
was handed. The frame metadata is carried as the engine reported it: the frame
counter, the accumulated simulated time, the delta, and the backing store size
are the axis a reviewer scrubs on and the figures a check asserts against.

## One copy of each entry

Consecutive frames of a game submit very nearly the same scene and issue very
nearly the same screen operations, and a build submits the identical draw
every frame for as long as an object sits still. A recording therefore holds
each distinct draw, light, camera, scene setting, geometry, texture, and
material once, each distinct screen operation once, and each distinct inherited
state block once, and a frame names its scene setting and camera by index and
its lights, draws, and operations by arrays of indices. Spans, embedded maps,
and screen images are shared on their bytes, resources on their recipes, and a
referenced asset travels once under its hash however many entries name it.

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
that got there. The scene is walked only while the recorder is armed. While it
is idle the screen wrapper costs one property lookup and one call per operation
and keeps four shadows: the recipe of each value the context produced, the
stack of saved states, the clip region in force, and the current path. A
frame's screen part inherits all four and a build establishes them long before
a caller arms the recorder, so they are maintained whenever the wrapper exists.

Each of the four is bounded. A recipe holds 1024 mutation steps, the save stack
holds 64 entries, and the clip and the current path hold 1024 path operations
each. A `beginPath` replaces the current path, and `reset` or a canvas reset
clears the clip and the path together. An engine that is never asked to record
therefore holds what its own gradients, clip, and path are worth, and nothing
per frame.

The asset loader's registry is kept for the loader's whole life for the same
reason: a model loaded before the first frame is referenced by a frame recorded
long after, and the registry is what lets that frame name the file by its hash
rather than carry the geometry it decoded. The registry holds each file's bytes
once, and the recording takes them only at the first frame that references the
file.

A recording holds what the build placed in the scene the engine renders and
drew through the screen context the engine handed it. A build that renders
through a renderer of its own or draws to a surface of its own is drawing
outside the recording, and a frame that submits no draws and emits no
operations while its pixels change is the signal that it did.
