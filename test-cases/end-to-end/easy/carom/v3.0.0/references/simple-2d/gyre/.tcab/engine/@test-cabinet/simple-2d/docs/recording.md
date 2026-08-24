# Recording

A recording is the drawing operations a build issued, frame by frame, in the
order it issued them. Replaying one against another 2D context reproduces the
picture the build drew, so a scenario can be handed to a reviewer as the build's
own drawing rather than as a re-shoot of it.

```ts
engine.recording(): boolean;
engine.startRecording(): void;
engine.stopRecording(): Recording;
```

| Member | Effect |
| --- | --- |
| `recording` | Whether operations are being captured right now. |
| `startRecording` | Arm the recorder. Capture begins at the next frame. |
| `stopRecording` | Disarm and return everything captured since `startRecording`. |

## Arming the recorder

The recorder is armed and disarmed around the frames that matter, so a caller
records the section of a run it cares about and pays nothing for the rest. It
shadows the context whether it is armed or not, because a frame inherits state
established long before arming.

An idle recorder holds four things: the recipe of each gradient and pattern the
context produced, the stack of saved states, the clip region in force, and the
current path. A recipe is bounded at 1024 mutation steps, the save stack at 64
entries, and the clip and the current path at 1024 path operations each. A
`beginPath` replaces the current path, and `reset` or a canvas reset clears the
clip and the path together. Nothing accumulates per frame.

```ts
const engine = createEngine({ canvas, width: 640, height: 360, game });
await engine.initialize();

await engine.advance(60);        // setup, not captured
engine.startRecording();
await engine.advance(120);       // the 120 frames the recording holds
const recording = engine.stopRecording();
```

Capture begins at the next frame rather than part-way through the current one,
so a caller that arms the recorder from inside `update` or `render` records
whole frames only. The frames a recording holds are therefore the frames that
ran entirely while it was armed.

The diagnostics overlay is drawn after the game's `render` and stays out of the
recording, so debug chrome never appears in a replay. Everything else a frame
draws is captured, including the engine's own clear and viewport transform,
which is what lets a replayed frame start from the same blank page the original
did.

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

| Field | Meaning |
| --- | --- |
| `format` | The format version, `RECORDING_FORMAT`. A player checks it before drawing anything. |
| `width` | The logical design width the operations were issued in. |
| `height` | The logical design height the operations were issued in. |
| `background` | The color each frame was cleared to, or `null` for transparency. |
| `images` | The bitmaps and pixel buffers the operations draw, by index. |
| `resources` | The values the context produced and the operations draw with, by index. |
| `ops` | Every distinct operation the recording holds, by index. |
| `states` | Every distinct inherited state block, by index. |
| `frames` | The frames captured, in order. |

`images`, `resources`, `ops`, and `states` belong to the whole recording rather
than to any one frame. Each holds every distinct entry once, and a frame names
the entries it needs by index, so a value produced on the first frame and still
in force a thousand frames later resolves when that later frame is drawn by
itself. The tables are settled when the recording is closed, from the frames it
holds. Every entry is one some frame names, and a canvas wiped part-way through a
frame takes the entries of the operations it erased with it.

`RECORDING_FORMAT` is exported from `@test-cabinet/simple-2d`, alongside every
type on this page.

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

| Field | Meaning |
| --- | --- |
| `count` | The engine's frame counter at this frame. |
| `timeMs` | Accumulated simulated time through this frame, in milliseconds. |
| `deltaMs` | What this frame was worth, in milliseconds. |
| `surface` | The canvas backing store this frame was drawn into, in device pixels. |
| `state` | Index into `states` of the context state this frame inherited, before its own operations. |
| `stack` | Indices into `states` of the states the context had saved when this frame opened, outermost first. |
| `ops` | Indices into `ops` of the operations this frame issued, in the order it issued them. |
| `truncated` | Present and `true` when the save stack, a clip region, or the current path this frame inherited was cut down to its bound. |

`count` and `timeMs` are the same figures `engine.frame()` reports, so a frame
in a recording is identified by the counter a check asserts against. See
`frame.md`.

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
a frame carrying a longer stack: the player applies a state and pushes a level
per entry, and a frame naming two hundred thousand valid indices costs seconds
inside one draw with the reviewer's tab frozen for all of it.

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

| Field | Meaning |
| --- | --- |
| `properties` | The style properties in force at the top of the frame, by name. |
| `transform` | The transform as `[a, b, c, d, e, f]`, or `null` when the context could not report one. |
| `lineDash` | The dash pattern, or `null` when the context could not report one. |
| `clip` | The clip region in force, as the segments that built it, in the order they were applied. |
| `path` | The current path, as the segments holding the path operations issued since the last `beginPath`. |

A property the context does not carry is omitted, so `properties` holds whatever
that context was able to report rather than a fixed list. A property holding a
gradient or a pattern records as a `$res`, so an inherited fill paints the same
way when the frame is drawn by itself.

### The clip region and the current path

A context reports every part of its state except the clip and the current path,
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

| Field | Meaning |
| --- | --- |
| `method` | The method called, for a `call`. |
| `args` | The call's arguments, encoded as `DrawValue`. |
| `property` | The property assigned, for a `set`. |
| `value` | The value assigned, encoded as `DrawValue`. |

Every entry of `ops` is an operation the context itself performed on itself. The
call that produced a gradient or a pattern, and every operation performed on
that value afterwards, belong to its `Resource` recipe instead.

A `set` records the value the build supplied rather than the value the context
normalized it to, so a color written as `#fff` records as `#fff`.

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

| Form | Meaning |
| --- | --- |
| `null`, `boolean`, `number`, `string` | The value itself. |
| Array | Each entry encoded in turn. |
| `{ $res: n }` | `resources[n]`, a value the context produced. |
| `{ $img: n }` | `images[n]`, a bitmap or pixel buffer. |
| `{ $opaque: "Name" }` | A value the recorder could not carry, named by its constructor. |
| `{ $opaque: "truncated" }` | The remainder of a container the expansion bound fell inside. |
| Object | A plain object, encoded field by field. |

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

| Field | Meaning |
| --- | --- |
| `kind` | How the value is rebuilt: `bitmap` as an image a context draws, `pixels` as `ImageData`. |
| `width` | The captured width in pixels. |
| `height` | The captured height in pixels. |
| `src` | A `data:image/png;base64,…` URL holding a `bitmap` entry's pixels. |
| `data` | A `pixels` entry's RGBA bytes, base64 encoded, four bytes per pixel in row order. |

Every bitmap source a build draws from is captured, so a sprite-based build
replays with its sprites. A `bitmap` entry rebuilds where a `CanvasImageSource`
is expected, for `drawImage` and `createPattern`. A `pixels` entry rebuilds as
the `ImageData` a `putImageData` writes, by decoding `data` straight into the
buffer, which is exact by construction and needs no image decoder.

A `pixels` entry carries its bytes because the canvas round trip a PNG needs is
lossy. Drawing an image into a canvas premultiplies each color channel by the
pixel's alpha, and reading the pixels back un-premultiplies them, so a partially
transparent pixel is quantized to eight bits twice and comes back a different
color. `ImageData` is the one kind of image a check compares byte for byte, so
it is carried byte for byte.

A source whose content is fixed is keyed on its identity and encoded once, so
the sprite sheets a build loads at startup cost one entry each however many
frames blit from them. An `HTMLImageElement` or `SVGImageElement` is keyed
together with the file it points at and the size it was captured at, so
re-pointing one at another file captures the new content. An `<img>` is captured
at its natural size; an `<image>` in an SVG document reports no natural size and
is captured at its layout size, so a drawing that resizes one captures it again.

A source whose content can change is captured at every use, and entries are
shared whenever their bytes match. A canvas, an offscreen canvas, a video, a
video frame and an `ImageData` therefore cost one entry however many times they
are drawn while their content stands, and one entry per picture they were drawn
under. That is what an `ImageData` mutated between two `putImageData` calls in
the same frame is worth.

Capture stops once a recording holds 16 MB of image bytes, counted over the
bytes the recording carries. Images already captured keep resolving, and a
further new capture records `{ $opaque: "<TypeName>" }`, which keeps a replay
loadable by a reviewer.

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

| Field | Meaning |
| --- | --- |
| `make` | The context call that created the value, with its arguments encoded as `DrawValue`. |
| `then` | The calls and assignments made on the value before this use, in order. |

Exactly four context methods produce a resource: `createLinearGradient`,
`createRadialGradient`, `createConicGradient`, and `createPattern`. A producing
call belongs to the recipe of the value it made rather than to the frame, so
`ops` holds no producing call. A `createPattern` handed a source it cannot use
answers `null`, which produces neither a resource nor an operation and travels
as the `null` it is.

A resource is captured at the moment the value is used, as an argument or as an
assigned value, and holds the creating call plus the mutations applied up to
that point. A style property holds a live reference to the value assigned to it,
so a gradient given another color stop after it was assigned to `fillStyle`
paints under that stop without ever being assigned again. A produced value is
therefore resolved as of the paint rather than as of the assignment.

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

Two uses of the same value with the same history name the same resource, and a
value that is created and never used is left out.

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

A produced value is tracked from the moment the context creates it, armed or
not, so a build that creates its gradients once at startup and fills with them
for the rest of its life records every fill under the stops that fill had. It
comes back tracked when it is read off the context, so a color stop added
through `ctx.fillStyle` joins the recipe of the gradient that property holds. A
recipe holds at most 1024 mutation steps, past which the value records as
`{ $opaque: … }`.

Everything else a context call returns is data rather than a resource, because
re-issuing a recipe is faithful only for a value whose content is independent of
context state:

| Returned value | Recorded as |
| --- | --- |
| `DOMMatrix`, `DOMMatrixReadOnly` | `{ a, b, c, d, e, f }`. |
| `ImageData` | A `CapturedImage` of kind `pixels`, referenced as a `$img`. |
| An array or a plain object | Its fields, encoded one by one. |
| Anything else | `{ $opaque: … }`. |

A matrix records as the `DOMMatrix2DInit` that `setTransform` accepts, so a
build that reads its transform, changes it, and later puts the original back
replays under the transform it drew with. Encoding an array or a plain object
field by field is what keeps the answers to `getLineDash` and
`getContextAttributes` out of the resource table.

## Numbers

Every number inside a `DrawValue`, a `DrawState`, a resource recipe, a
transform, or a dash array is written to at most nine significant digits. That
resolves to about a millionth of a pixel over a design space of a thousand-odd
units, so the digits past it describe the arithmetic that produced a coordinate
rather than the picture it draws.

The frame metadata is exact. `count`, `timeMs`, `deltaMs`, and `surface` are
carried as the engine reported them, because they are the figures a check
asserts against and the axis a reviewer scrubs on.

## Every frame stands alone

A frame names everything the context carried into it: the style properties, the
transform, the dash pattern, the clip region, the current path, and the states
saved under it. Every value its operations draw with lives in a table the whole
recording shares, so drawing a frame needs nothing from the frames before it:

1. Blank the context.
2. For each entry of `frame.stack`, outermost first: apply that state, then
   `save` the context.
3. Apply `states[frame.state]`.
4. Issue each of `frame.ops` in order, resolving it through `ops`.

Applying a state means its `properties`, then each of its `clip` segments under
the transform that segment carries, then `beginPath`, then each of its `path`
segments under the transform that segment carries, then the state's own
`transform`, then its `lineDash`.

A `$img` resolves against the decoded image table. A `$res` is built by issuing
`make` against the context being drawn into, because a gradient and a pattern
are bound to the context that created them, and then applying each entry of
`then` to what came back.

A player performs an assignment only to a property the subject carries and will
take: one found by walking the subject and its prototypes as far as, and not
including, `Object.prototype`, holding either a setter or a writable value. Any
other name is skipped and reported. `__proto__` is the name that makes this
load-bearing. A build doing `ctx.__proto__ = null` records an ordinary
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

This is what makes seeking to any frame a constant-time operation, and what lets
two recordings of the same scenario be scrubbed side by side in step.

### The reach of frame independence

Two properties of the canvas bound how exactly a frame drawn on its own
reproduces what was on screen at that moment. `putImageData` writes through the
clip, so pixels it wrote under a clip belong to no frame's state and no later
frame's clipped clear reaches them: a replay drawn from a single frame is
cleaner than the original was.

A clip whose edge falls between device pixels is antialiased, and a boundary
pixel is covered partly by what the frame paints and partly by what is already
there. The original shows the frame before it through that coverage and a seek
shows the background. Frame independence is exact for clips on whole device
pixels, and exact in every other respect.

## Storing a recording

A recording is stored and served gzipped, under both extensions:
`<name>.json.gz`. The document is repetitive by design, because frames name the
same shared entries over and over and a game's operations differ from their
neighbours' by a few coordinates, so it compresses to a small fraction of its
size. A real capture stores several times smaller gzipped.

The document inside is the recording as `stopRecording` handed it back.
Compression is how a recording travels rather than part of what it is, so a
reader decompresses and then reads the same JSON.

## What a recording holds

A recording holds the operations issued through the context the engine handed
the game. A build that draws to a surface of its own draws outside the
recording, and a frame that emits no operations while its pixels change is the
signal that it did. Draw through `RenderApi.ctx` and everything a frame drew is
captured.

## Errors

| Condition | Result |
| --- | --- |
| `startRecording` while already recording | `Error` naming the unbalanced call |
| `stopRecording` while not recording | `Error` naming the unbalanced call |

Both refuse rather than proceed, because the mistake is always an unbalanced
call and an empty recording handed back from one reads as a build that drew
nothing.
