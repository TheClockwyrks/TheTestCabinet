# Recording

A recording is the drawing operations a build issued against its scene context,
frame by frame, in the order it issued them. Re-issuing one against another
scene reproduces the picture the build drew, so a scenario can be handed to a
reviewer as the build's own drawing rather than as a re-shoot of it.

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
records the section of a run it cares about and pays nothing for the rest.

```ts
const engine = createEngine({ canvas, width: 640, height: 360, game });
await engine.initialize();

await engine.advance(60);        // setup, not captured
engine.startRecording();
await engine.advance(120);       // the 120 frames the recording holds
const recording = engine.stopRecording();
```

Capture begins at the frame after `startRecording`, so a caller that arms the
recorder from inside `update` or `render` records whole frames only. A frame
that opened while the recorder was armed and closes after `stopRecording` is
dropped. The frames a recording holds are therefore the frames that ran entirely
while it was armed.

The design size and background a recording reports are fixed when the recorder
is armed, taken from the engine's own `EngineOptions` rather than read back when
the recording is closed.

A frame is bracketed around the engine's frame preparation and the game's
`render`. The clear with its depth reset, the viewport fit, and the renderer
state in force are inside the bracket; the diagnostics overlay draws on its own
surface, after the render, and never enters the recording.

## `Recording`

```ts
interface Recording {
  format: number;
  space: "3d";
  width: number;
  height: number;
  background: string | null;
  assets: readonly CapturedAsset[];
  resources: readonly Resource[];
  ops: readonly DrawOp[];
  states: readonly RenderState[];
  frames: readonly RecordedFrame[];
}
```

| Field | Meaning |
| --- | --- |
| `format` | The format version, equal to `RECORDING_FORMAT`. A player checks it before drawing anything. |
| `space` | `"3d"`: the document is drawn with the 3D drawer. |
| `width` | The logical design width the operations were issued in. |
| `height` | The logical design height the operations were issued in. |
| `background` | The CSS color each frame was cleared to, or `null` for transparency. |
| `assets` | The meshes, textures, and materials the operations draw, by index. |
| `resources` | The values the scene context produced and the operations draw with, by index. |
| `ops` | Every distinct operation the recording holds, by index. |
| `states` | Every distinct inherited renderer state, by index. |
| `frames` | The frames captured, in order. |

`assets`, `resources`, `ops`, and `states` belong to the whole recording rather
than to any one frame. Each holds every distinct entry once, and a frame names
the entries it needs by index, so a value produced on the first frame and still
in force a thousand frames later resolves when that later frame is drawn by
itself. The tables are settled when the recording is closed, from the frames it
holds, and every entry is one some frame names.

`RECORDING_FORMAT` is exported from `@test-cabinet/simple-3d`, alongside every
type on this page. There is one recording format and it is version `1`.
`space: "3d"` is what tells a player to draw the document with the 3D drawer; a
2D recording carries no `space` field, so absent means 2D and one player serves
every engine's recordings. A player refuses a document whose `format` or `space`
it does not know, which is a document no recorder wrote.

## `RecordedFrame`

```ts
interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  state: number;
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
| `state` | Index into `states` of the renderer state this frame inherited, before its own operations. |
| `ops` | Indices into `ops` of the operations this frame issued, in the order it issued them. |
| `truncated` | Present and `true` when the light list this frame inherited was cut down to its bound. |

`count`, `timeMs`, and `deltaMs` are the figures `engine.frame()` reports for
the same frame, so a frame in a recording is identified by the counter a check
asserts against. See `frame.md`.

There is no `stack` field. The scene context has no `save`/`restore`, no clip,
and no path machinery, so nothing beyond the renderer state survives a frame
boundary and nothing else needs carrying.

## `RenderState`

What survives a frame boundary is the renderer state: the camera, the lights,
and the render mode, each set through the scene context and holding until set
again. A frame's operations are its draw calls, any state-setting calls, and any
depth clears it issued; its inherited state is the renderer state in force when
it opened.

```ts
type RenderMode = "standard" | "wireframe" | "unlit" | "normals";

type Color = string;

type LightState =
  | { type: "ambient"; color: Color; intensity: number }
  | { type: "directional"; color: Color; intensity: number; direction: Vec3 }
  | { type: "point"; color: Color; intensity: number; position: Vec3; range: number };

interface RenderState {
  camera: CameraState;
  lights: readonly LightState[];
  mode: RenderMode;
}
```

| Field | Meaning |
| --- | --- |
| `camera` | The `CameraState` in force at the top of the frame. |
| `lights` | The light list in force, at most 64 entries. |
| `mode` | The render mode in force. `"standard"` is the lit default. |

A fresh engine's renderer state is the defaults: the default `CameraState`, an
empty light list, and `"standard"`. A frame that inherited a light list the
recorder cut down to 64 carries `truncated: true`, and a player reports the flag
beside everything else it could not reproduce, which is what lets a reviewer
tell a picture the format could not carry from one it carried.

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

Every entry of `ops` is an operation performed on the scene context itself: one
of the three state setters, `clearDepth`, or one of the six draw calls. The
scene context declares no assignable properties, so a conforming recording's
`ops` holds `call` entries only; `set` remains part of the format. A call's
arguments are resolved before the call is issued, and a producing call belongs
to the recipe of the value it made rather than to the frame.

## `DrawValue`

```ts
type DrawValue =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue[]
  | { readonly $res: number }
  | { readonly $asset: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue };
```

| Form | Meaning |
| --- | --- |
| `null`, `boolean`, `number`, `string` | The value itself. |
| Array | Each entry encoded in turn. |
| `{ $res: n }` | `resources[n]`, a value the scene context produced. |
| `{ $asset: n }` | `assets[n]`, a loaded mesh, texture, or material. |
| `{ $opaque: "Name" }` | A value the recorder could not carry, named by its constructor. |
| `{ $opaque: "truncated" }` | The remainder of a container the expansion bound fell inside. |
| Object | A plain object, encoded field by field. |

The structured values the scene context takes encode as their plain-data shapes:
a `Vec3` as `{ x, y, z }`, a `Quat` as `{ x, y, z, w }`, a `Transform` as
`{ position, rotation, scale }`, a `CameraState` and a `LightState` field by
field. A handle encodes as `{ $asset: n }` and a produced geometry or material
as `{ $res: n }`.

A player draws an operation whose arguments resolve and reports one carrying an
`$opaque` value rather than substituting something else.

Encoding a value always terminates in one of these forms. A cyclic object and an
object whose getter throws each record as `{ $opaque: … }`, so a build draws the
same pixels whether or not anything is being captured.

Two bounds keep the encoding finite. The value an operation carries sits at
depth zero, and an array or plain object reached at depth 32 records as
`{ $opaque: … }` rather than being expanded. One encoded value also expands into
at most 65,536 values, counted over every value the walk reaches. A container the
expansion bound falls inside stops there and carries its remainder as a single
`{ $opaque: "truncated" }`: the last element of an array, and the field named
`$rest` of an object. Both bounds are part of the format rather than a choice a
recorder makes, so every recorder writing this format answers the same input
with the same document.

## `CapturedAsset`

The assets the operations draw with, carried inside the recording so a replay
needs nothing from the run's tree.

```ts
type CapturedAsset =
  | { kind: "mesh"; path: string; data: string }
  | { kind: "texture"; path: string; width: number; height: number; src: string }
  | {
      kind: "material";
      path: string;
      maps: Readonly<Partial<Record<MaterialMapSlot, number>>>;
    };
```

| Field | Meaning |
| --- | --- |
| `path` | The asset path the handle was loaded from. |
| `mesh.data` | The glTF binary's bytes, base64 encoded. |
| `texture.width`/`height` | The decoded size in pixels. |
| `texture.src` | A `data:image/png;base64,…` URL holding the texture's pixels. |
| `material.maps` | Indices into `assets` of the material's textures, per slot. |

A handle is immutable and loaded once, so it is keyed on identity and captured
once, however many frames draw it. Capture stops once the recording holds 16 MB
of asset bytes, counted over `data` and `src`. Assets already captured keep
resolving, and a further new capture records `{ $opaque: "MeshHandle" }` — or
the handle's own type name — the same degradation a player already reports. An
entry that fails to decode at replay is skipped and reported.

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
| `make` | The scene-context call that created the value, with its arguments encoded as `DrawValue`. |
| `then` | The calls and assignments made on the value before this use, in order. |

A resource is a value the scene context produced: the geometries and materials
built in code. Exactly six methods produce one — `createBox`, `createSphere`,
`createCylinder`, `createCapsule`, `createPlane`, and `createMaterial` — and a
producing call belongs to the recipe of the value it made rather than to the
frame, so `ops` holds no producing call.

A produced value is immutable, so its recipe is its `make` with an empty `then`,
and its identity is the call that made it. A resource is captured at the moment
the value is used, two uses with the same arguments share one entry, and a value
that is created and never used is left out. Per-frame creation therefore costs
nothing in the recording: a `render` that calls `createSphere(1)` on all 120 of
its frames leaves one entry in `resources`.

The recorder collects a produced value's recipe from the moment the scene
context creates it, whether or not the recorder is armed, so a build that
creates its materials once and draws with them for the rest of its life records
every draw under the material it drew with. A recipe holds at most 1024 mutation
steps, past which the value records as `{ $opaque: … }`; both rules are the
format's own.

## Numbers

Every number inside a `DrawValue`, a `RenderState`, or a resource recipe is
written to at most nine significant digits. That resolves far below what a
picture shows over a design space of a thousand-odd units, so the digits past it
describe the arithmetic that produced a coordinate rather than the picture it
draws.

The frame metadata is exact. `count`, `timeMs`, `deltaMs`, and `surface` are
carried as the engine reported them, because they are the figures a check
asserts against and the axis a reviewer scrubs on.

## Every frame stands alone

A frame names everything the renderer carried into it, and every value its
operations draw with lives in a table the whole recording shares, so drawing a
frame needs nothing from the frames before it:

1. Blank the context: clear to `background`, transparent when `null`, at the
   frame's `surface` size, with the depth state reset.
2. Apply `states[frame.state]`: the mode, the camera, then the lights.
3. Issue each of `frame.ops` in order, resolving each `$asset` against the
   decoded asset table and each `$res` on demand through its recipe.

A `$res` is built by issuing `make` against the scene being drawn into and
applying each entry of `then` to what came back, and a built resource is reused
for the rest of that frame. An operation carrying an `$opaque` value, naming an
asset that failed to decode, or naming a resource that failed to build is
skipped and reported, so a replay accounts for every operation it leaves out.

Frame independence is exact, with no exceptions clause. There is no save stack,
no clip, and no pixel write-back: the renderer state a frame inherits is three
values, every draw call is self-contained, and a frame drawn by itself is the
frame that was on screen. Seeking to any frame therefore costs what drawing it
costs, and two recordings of the same scenario scrub side by side in step.

## Storing a recording

A recording is stored and served gzipped, under both extensions:
`<name>.json.gz`. The document is repetitive by design, because frames name the
same shared entries over and over and a game's operations differ from their
neighbours' by a few coordinates, so it compresses to a small fraction of its
size. The document inside is the recording exactly as `stopRecording` handed it
back: compression is how a recording travels rather than part of what it is.

## What a recording holds

A recording holds the operations issued through the scene context the engine
handed the game. A build that draws to a surface of its own draws outside the
recording, and a frame that emits no operations while its pixels change is the
signal that it did. Draw through `RenderApi.scene` and everything a frame drew is
captured.

## Errors

| Condition | Result |
| --- | --- |
| `startRecording` while already recording | `Error` naming the unbalanced call |
| `stopRecording` while not recording | `Error` naming the unbalanced call |

Both refuse rather than proceed, because the mistake is always an unbalanced
call and an empty recording handed back from one reads as a build that drew
nothing.
