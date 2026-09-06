---
title: Recording
---

Draw-command recording captures the operations a build issues against its 2D
context, frame by frame, as a value a player re-issues against another context
to reproduce the picture. The recorder is part of the engine, armed and disarmed
through the [`Engine`](/engines/simple-2d/apis/engine/) object.

## Engine members

```ts
recording(): boolean;
startRecording(): void;
stopRecording(): Recording;
```

| Member             | Returns     | Behavior                                                                     |
| ------------------ | ----------- | ---------------------------------------------------------------------------- |
| `recording()`      | `boolean`   | Whether operations are being captured.                                       |
| `startRecording()` | `void`      | Arms the recorder. Capture begins at the next frame.                         |
| `stopRecording()`  | `Recording` | Disarms the recorder and returns everything captured since `startRecording`. |

`startRecording` throws when the recorder is already armed, and `stopRecording`
throws when it is not. Both name the unbalanced call.

The design size and background a recording reports are fixed when the recorder
is armed, taken from the engine's own
[`EngineOptions`](/engines/simple-2d/apis/engine/) rather than read back from
the canvas when the recording is closed.

## Frame boundaries

Capture begins at the frame after `startRecording`, so a recorder armed from
inside `update` or `render` captures whole frames only. A frame that opened
while the recorder was armed and closes after `stopRecording` is dropped.

A frame is bracketed around the engine's frame preparation and the game's
`render`. The clear and the viewport transform are inside the bracket; the
[diagnostics](/engines/simple-2d/apis/diagnostics/) overlay, drawn after the
render with the transform reset, is outside it.

## `Recording`

```ts
interface Recording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  images: readonly CapturedImage[];
  resources: readonly Resource[];
  ops: readonly DrawOp[];
  states: readonly DrawState[];
  frames: readonly RecordedFrame[];
}
```

| Field        | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `format`     | The format version, equal to `RECORDING_FORMAT`.                        |
| `width`      | The logical design width the operations were issued in.                 |
| `height`     | The logical design height the operations were issued in.                |
| `background` | The CSS color each frame was cleared to, or `null` for transparency.    |
| `images`     | The bitmaps and pixel buffers the operations draw, by index.            |
| `resources`  | The values the context produced and the operations draw with, by index. |
| `ops`        | Every distinct operation the recording holds, by index.                 |
| `states`     | Every distinct inherited state block, by index.                         |
| `frames`     | The frames captured, in order.                                          |

`images`, `resources`, `ops`, and `states` belong to the whole recording rather
than to any one frame. Each holds every distinct entry once, and a frame names
the entries it needs by index, so a value produced on the first frame and still
in force a thousand frames later resolves when that later frame is drawn by
itself. The tables are settled when the recording is closed, from the frames it
holds. Every entry is one some frame names, and a canvas wiped part-way through a
frame takes the entries of the operations it erased with it.

`RECORDING_FORMAT` is the integer this engine writes. There is one recording
format and it is version `1`; a player reads the field first so it can refuse a
document stating anything else, which is a document no recorder wrote.

## `RecordedFrame`

```ts
interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  state: number;
  stack: readonly number[];
  ops: readonly number[];
  truncated?: boolean;
}
```

| Field       | Meaning                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `count`     | The engine's frame counter at this frame.                                                                                  |
| `timeMs`    | Accumulated simulated time through this frame, in milliseconds.                                                            |
| `deltaMs`   | What this frame was worth, in milliseconds.                                                                                |
| `surface`   | The canvas backing store this frame was drawn into, in device pixels.                                                      |
| `state`     | Index into `states` of the context state this frame inherited, before its own operations.                                  |
| `stack`     | Indices into `states` of the states the context had saved when this frame opened, outermost first.                         |
| `ops`       | Indices into `ops` of the operations this frame issued, in the order it issued them.                                       |
| `truncated` | Present and `true` when the save stack, a clip region, or the current path this frame inherited was cut down to its bound. |

`count`, `timeMs`, and `deltaMs` are the figures
[`FrameInfo`](/engines/simple-2d/apis/game/) carries for the same frame.

A build is free to call `save` on one frame and `restore` on the next, so the
stack of saved states survives a frame boundary along with the state on top of
it. `stack` carries those states, and a player pushes them before applying the
frame's own state, which is what makes a `restore` among the frame's operations
return to the state the original returned to.

`stack` holds at most 64 entries. A build that saves more often than it restores
runs deeper than that, and the entries kept are the innermost ones, because a
`restore` pops the innermost first. The bound is what keeps an unbalanced `save`
from costing a longer stack at every frame open for the rest of a recording. It
is part of the format rather than a choice a recorder makes, so a player refuses
a document carrying a longer stack: the player applies a state and pushes a
level per entry, and a frame naming two hundred thousand valid indices costs six
and a half seconds inside one draw with the reviewer's tab frozen for all of it.

The clip region and the current path are shadowed and bounded at 1024 path
operations each, because neither has a frame boundary to bound it. The current
path keeps the operations it already holds and refuses each further one, so a
frame inherits the prefix of the path the build built.

A `clip` call costs the whole of the path in force plus the call itself, and it
is carried whole or not at all, because half a clip path is a region the build
never had. It is refused when the region it would leave behind runs past 1024
operations, and refused when the path it would take is itself a prefix. A
refused clip leaves the region in force as it stands, so a frame inherits a
region wider than the one the build was drawing under.

`truncated` is written on a frame that inherited a save stack, a clip region, or
a current path the recorder had cut down, and a single flag stands for however
many of the three. A clip region counts whether it belongs to the frame's own
state or to a state on its stack. A player reports the flag beside everything
else it could not reproduce, which is what lets a reviewer tell a picture the
format could not carry from one it carried.

## `DrawState`

```ts
interface DrawState {
  properties: Readonly<Record<string, DrawValue>>;
  transform: readonly number[] | null;
  lineDash: readonly number[] | null;
  clip: readonly PathSegment[];
  path: readonly PathSegment[];
}

interface PathSegment {
  transform: readonly number[] | null;
  ops: readonly DrawOp[];
}
```

| Field        | Meaning                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `properties` | The style properties in force at the top of the frame, by name.                                  |
| `transform`  | The transform as `[a, b, c, d, e, f]`, or `null` when the context reported none.                 |
| `lineDash`   | The dash pattern, or `null` when the context reported none.                                      |
| `clip`       | The clip region in force, as the segments that built it, in the order they were applied.         |
| `path`       | The current path, as the segments holding the path operations issued since the last `beginPath`. |

`properties` covers the canvas state that survives a frame boundary: the alpha,
the composite operation, the filter, the image smoothing, the stroke and fill
styles, the shadow, the line settings, and the text settings. A property the
context does not carry, or refuses to report, is omitted, so the same recorder
runs over a browser context and over the native canvas a validator builds on.

A style property holding a gradient or a pattern records as a `$res`, which
resolves from the shared table, so a fill inherited from an earlier frame paints
the same way when the frame is drawn by itself.

### The clip region and the current path

A canvas reports every part of its state except the clip and the current path,
so the recorder shadows both. It keeps the path operations issued since the last
`beginPath` as the current path, and a `clip` call moves that path, together
with the `clip` call itself, onto the clip region already in force. Clips
intersect, so the region in force is every segment of `clip` applied in turn.

A `PathSegment` carries the transform that was in force when its operations were
issued, because a path is given in user space. Both `clip` and `path` are split
into one segment per transform, and a player replays each segment under the
transform that segment carries before setting the state's own.

The current path survives a frame boundary, and `beginPath` and `reset` clear
it, so a build is free to open a path on one frame and fill it on the next.
Applying an inherited clip is what makes carrying the path unavoidable:
replaying a clip segment's path operations leaves the clip outline current, so a
state that stopped at the clip would leave a bare `fill` among the frame's
operations filling that outline. Applying a state therefore issues `beginPath`
after the clip segments and before the path segments.

The clip travels with the rest of the state through `save` and `restore`, and
`reset` clears it. The current path sits outside the saved state and survives
both, so a stack entry carries an empty `path` and the path in force is carried
by the state a frame opens with.

### A canvas reset

Writing `canvas.width` or `canvas.height` resets the context: the transform
returns to the identity, the style properties return to their defaults, the clip
region is discarded, and the save stack is emptied. The engine synchronizes its
backing store from inside the frame bracket, so a recording has to survive one,
and `canvas.width = canvas.width` is the ordinary way a build clears its
surface.

The recorder detects a reset by watching the element. It installs its own
`width` and `height` accessors on the canvas, each forwarding to the accessor it
inherits and telling the recorder after the write, so a reset that leaves the
size exactly where it was is seen. The accessors go on only where the canvas
inherits an accessor pair, and the fallback is the backing store size, read
before each shadowed operation and before each state snapshot: a size that
differs from the one last seen is a context that was reset between the two.

A reset clears the save stack, the clip, and the current path. The transform,
the properties, and the dash are read back from the context itself and correct
themselves. A reset inside a frame also discards the operations that frame had
already recorded, because the wipe erased the pixels they drew, and the frame's
inherited state is taken again against the context the reset left.

## `DrawOp`

```ts
type DrawOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };
```

| Field      | Meaning                                       |
| ---------- | --------------------------------------------- |
| `method`   | The method called.                            |
| `args`     | The call's arguments, encoded as `DrawValue`. |
| `property` | The property assigned.                        |
| `value`    | The value assigned, encoded as `DrawValue`.   |

Every entry of `ops` is an operation the context itself performed on itself. The
call that produced a gradient or a pattern, and every operation performed on
that value afterwards, belong to its `Resource` recipe instead, so a player
issues each operation against the context it is drawing into and has nothing
else to dispatch on.

A `set` records the value the build supplied rather than the value the context
normalized it to, so a color written as `#fff` records as `#fff` and the
recording states what the build did.

A call's arguments are resolved before the call is issued, because a call can
change what its own argument holds. `ctx.drawImage(ctx.canvas, …)` is the
ordinary trails blit, and a source read after the blit is the surface the blit
left behind, which replays as the picture composited on top of itself.

## `DrawValue`

```ts
type DrawValue =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue[]
  | { readonly $res: number }
  | { readonly $img: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue };
```

| Form                                  | Meaning                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `null`, `boolean`, `number`, `string` | The value itself.                                               |
| Array                                 | Each entry encoded in turn.                                     |
| `{ $res: n }`                         | `resources[n]`, a value the context produced.                   |
| `{ $img: n }`                         | `images[n]`, a bitmap or pixel buffer.                          |
| `{ $opaque: "Name" }`                 | A value the recorder could not carry, named by its constructor. |
| `{ $opaque: "truncated" }`            | The remainder of a container the expansion bound fell inside.   |
| Object                                | A plain object, encoded field by field.                         |

A player draws an operation whose arguments resolve and reports one carrying an
`$opaque` value rather than substituting something else.

Encoding a value always terminates in one of these forms. A cyclic object and an
object whose getter throws each record as `{ $opaque: … }`, so a build draws the
same pixels whether or not anything is being captured.

Two bounds keep the encoding finite. The value an operation carries sits at
depth zero, and an array or plain object reached at depth 32 records as
`{ $opaque: … }` rather than being expanded, so a container wrapped in 32 others
is a marker. One encoded value also expands into at most 65,536 values, counted
over every value the walk reaches. A structure whose nodes are shared resolves
once and is charged again wherever it is reached, because the document writes
the sharing out in full.

A container the expansion bound falls inside stops there and carries its
remainder as a single `{ $opaque: "truncated" }`: the last element of an array,
and the field named `$rest` of an object. Both bounds are part of the format
rather than a choice a recorder makes, so every recorder writing this format
answers the same input with the same document.

## `CapturedImage`

```ts
type CapturedImage =
  | { kind: "bitmap"; width: number; height: number; src: string }
  | { kind: "pixels"; width: number; height: number; data: string };
```

| Field    | Meaning                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| `kind`   | How the value is rebuilt: `bitmap` as an image a context draws, `pixels` as `ImageData`. |
| `width`  | The captured width in pixels.                                                            |
| `height` | The captured height in pixels.                                                           |
| `src`    | A `data:image/png;base64,…` URL holding a `bitmap` entry's pixels.                       |
| `data`   | A `pixels` entry's RGBA bytes, base64 encoded, four bytes per pixel in row order.        |

A `bitmap` entry rebuilds where a `CanvasImageSource` is expected, for
`drawImage` and `createPattern`. A `pixels` entry rebuilds as the `ImageData` a
`putImageData` writes, by decoding `data` straight into the buffer, which is
exact by construction and needs no image decoder.

A `pixels` entry carries its bytes because the canvas round trip a PNG needs is
lossy. Drawing an image into a canvas premultiplies each color channel by the
pixel's alpha, and reading the pixels back un-premultiplies them, so a partially
transparent pixel is quantized to eight bits twice and comes back a different
color. `ImageData` is the one kind of image a check compares byte for byte, so
it is carried byte for byte.

A fixed source is keyed on its identity and encoded once, so the common sprite
case is carried a single time however many frames draw it. An `HTMLImageElement`
or `SVGImageElement` is keyed together with the file it points at and the size
it was captured at, so re-pointing one at another file captures the new content.
An `<img>` is captured at its natural size; an `<image>` in an SVG document
reports no natural size and is captured at its layout size, so a drawing that
resizes one captures it again. An `ImageBitmap` is immutable and is keyed on
identity alone.

A mutable source is captured at every use and entries are shared on the bytes
they hold. An `HTMLCanvasElement`, `OffscreenCanvas`, `HTMLVideoElement`,
`VideoFrame`, or `ImageData` therefore costs one entry however many times it is
drawn while its content stands, and one entry per distinct content it is drawn
under. Capturing at every use is what lets an `ImageData` mutated between two
`putImageData` calls in the same frame replay as two different pictures.

Capture stops once the recording holds 16 MB of image bytes, counted over the
bytes the recording carries. Images already captured keep resolving, and a
further new capture records `{ $opaque: "<TypeName>" }`, the same degradation a
player already reports.

## `Resource`

```ts
interface Resource {
  make: { method: string; args: readonly DrawValue[] };
  then: readonly ResourceOp[];
}

type ResourceOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };
```

| Field  | Meaning                                                                             |
| ------ | ----------------------------------------------------------------------------------- |
| `make` | The context call that created the value, with its arguments encoded as `DrawValue`. |
| `then` | The calls and assignments made on the value before this use, in order.              |

Exactly four context methods produce a resource: `createLinearGradient`,
`createRadialGradient`, `createConicGradient`, and `createPattern`. A producing
call belongs to the recipe of the value it made rather than to the frame, so
`ops` holds no producing call. A `createPattern` that answers `null` produces
neither a resource nor an operation, and the `null` travels as itself.

A resource is captured at the moment the value is used, as an argument or as an
assigned value, and holds the creating call plus the mutations applied up to
that point. Two uses of the same value with the same history name the same
resource, and a value that is created and never used is left out.

Capturing at the moment of use is what keeps a gradient honest. A style property
holds a live reference to the value assigned to it, so a gradient given another
color stop after it was assigned to `fillStyle` paints under that stop without
ever being assigned again. A produced value is therefore resolved as of the
paint rather than as of the assignment.

Six calls paint through the style properties: `fill`, `stroke`, `fillRect`,
`strokeRect`, `fillText`, and `strokeText`. Before recording one of them, the
recorder compares each style property holding a produced value against the
encoding it last emitted for that property. A recipe that has grown since then
means the property paints something else now, so the recorder records a
corrective `set` for that property first and the operations that follow state
what the context is about to paint.

The record of what was last emitted travels with the state. A `save` copies it
onto the save stack and a `restore` puts back the copy taken at the matching
`save`, so a paint after a restore is measured against the encoding that was in
force when that state was saved, which is what a `restore` returns the player's
context to. A `reset` or a canvas reset empties the record along with the rest
of the state, and an assignment of a value the context did not produce drops the
entry for that property.

The recorder collects a produced value's recipe from the moment the context
creates it, whether or not the recorder is armed, so a build that creates its
gradients once at startup and fills with them for the rest of its life records
every fill under the stops that fill had. A recipe holds at most 1024 mutation
steps, past which the value records as `{ $opaque: … }`.

A recipe's arguments are as of the producing call. `createPattern` copies its
source when it is called, so a pattern made from a scratch canvas holds the
picture that canvas carried at that moment and keeps it when the canvas is
repainted afterwards.

Encoding therefore runs in two stages. A value is resolved into a portable form
when it is observed, at a producing call, at a mutation step, or at an
assignment: a host object becomes captured bytes, a nested recipe, or an opaque
marker, and every number is rounded. That portable form is interned into the
running recording's tables at the moment of use, so only the table indices are
deferred and a pattern's source appears in `make.args` as a `$img` naming the
bytes the pattern was made from.

### Everything else a context call returns

A recipe is re-issued against the context a player is drawing into, which is
faithful only for a value whose content is independent of context state. The
rest of what a context call returns is therefore carried as data:

| Returned value                   | Recorded as                                                 |
| -------------------------------- | ----------------------------------------------------------- |
| `DOMMatrix`, `DOMMatrixReadOnly` | `{ a, b, c, d, e, f }`.                                     |
| `ImageData`                      | A `CapturedImage` of kind `pixels`, referenced as a `$img`. |
| An array or a plain object       | Its fields, encoded one by one.                             |
| Anything else                    | `{ $opaque: … }`.                                           |

A matrix records as the `DOMMatrix2DInit` that `setTransform` accepts, so a
build that reads its transform, changes it, and later puts the original back
replays under the transform it drew with. Encoding an array or a plain object
field by field is what keeps the answers to `getLineDash` and
`getContextAttributes` out of the resource table.

## Numbers

Every number inside a `DrawValue`, a `DrawState`, a resource recipe, a
transform, or a dash array is written to at most nine significant digits. Nine
significant digits over a design space of a thousand-odd units resolves to about
a millionth of a pixel, so the digits past that describe the arithmetic that
produced a coordinate rather than the picture it draws.

The frame metadata is exact. `count`, `timeMs`, `deltaMs`, and `surface` are the
axis a reviewer scrubs on and the surface a frame was drawn into, and both are
compared against figures a check asserts.

## Drawing a frame

Every frame is drawn from itself alone:

1. Blank the context.
2. For each entry of `frame.stack`, outermost first: apply that state, then
   `save` the context.
3. Apply `states[frame.state]`.
4. Issue each of `frame.ops` in order, resolving it through `ops`.

Applying a state means its `properties`, then each of its `clip` segments under
the transform that segment carries, then `beginPath`, then each of its `path`
segments under the transform that segment carries, then the state's own
`transform`, then its `lineDash`.

A `$img` resolves against the decoded image table. A `$res` is built on demand:
issue `make` against the context being drawn into, because a gradient and a
pattern are bound to the context that created them, then apply each entry of
`then` to what came back. A built resource is reused for the rest of that frame.

A player performs an assignment only to a property the subject carries and will
take: one found by walking the subject and its prototypes as far as (and not
including) `Object.prototype`, holding either a setter or a writable value. Any
other name is skipped and reported. `__proto__` is the name that makes this
load-bearing — a build doing `ctx.__proto__ = null` records an ordinary
assignment, and performing it severs the prototype every canvas method lives on,
so the next frame's blank finds no `setTransform` and the failure leaves the
player rather than being reported by it.

A `bitmap` entry that fails to decode resolves to nothing, and an operation
naming it is skipped and reported the way an operation carrying an `$opaque`
value is. A `$res` whose recipe fails to build, or which builds to `null`, is
reported the same way. A `pixels` entry is rebuilt from its own bytes, with no
decoder in the way, and fails in three ways of its own: `data` that is not
base64, a byte count that disagrees with `width × height × 4`, and a host with
no `ImageData` to hold the result. Each is refused and reported like a bitmap
that would not decode.

Every reference a frame carries, including every reference in its inherited
state and in its save stack, resolves from the recording's own tables. Seeking
to a frame therefore costs what drawing it costs.

### The reach of frame independence

A frame carries the whole of the state it opened with and every value its
operations draw with lives in a table the whole recording shares, so a player
lands on any frame and draws it from the recording alone. Two properties of the
canvas bound how exactly that reproduces what was on screen at that moment.

`putImageData` writes through the clip. Pixels it wrote under a clip belong to
no frame's state and no later frame's clipped clear reaches them, so a replay
drawn from a single frame is cleaner than the original was.

A clip whose edge falls between device pixels is antialiased, and a boundary
pixel is covered partly by what the frame paints and partly by what is already
there. The original shows the frame before it through that coverage and a seek
shows the background. Frame independence is exact for clips on whole device
pixels, and exact in every other respect.

## Exports

`Recording`, `RecordedFrame`, `DrawState`, `PathSegment`, `DrawOp`, `DrawValue`,
`CapturedImage`, `Resource`, and `ResourceOp` are exported as types from
`@clockwyrks/simple-2d`, and `RECORDING_FORMAT` is exported as a value from
the same entry point.
