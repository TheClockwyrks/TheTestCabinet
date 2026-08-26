---
title: Recording
---

Draw-command recording captures the operations a build issues against its
[scene context](/engines/simple-3d/apis/game/), frame by frame, as a value a
player re-issues against another scene to reproduce the picture. The recorder
is part of the engine, armed and disarmed through the
[`Engine`](/engines/simple-3d/apis/engine/) object.

## Engine members

```ts
recording(): boolean;
startRecording(): void;
stopRecording(): Recording;
```

| Member | Returns | Behavior |
| --- | --- | --- |
| `recording()` | `boolean` | Whether operations are being captured. |
| `startRecording()` | `void` | Arms the recorder. Capture begins at the next frame. |
| `stopRecording()` | `Recording` | Disarms the recorder and returns everything captured since `startRecording`. |

`startRecording` throws when the recorder is already armed, and `stopRecording`
throws when it is not. Both name the unbalanced call.

The design size and background a recording reports are fixed when the recorder
is armed, taken from the engine's own
[`EngineOptions`](/engines/simple-3d/apis/engine/) rather than read back when
the recording is closed.

## Frame boundaries

Capture begins at the frame after `startRecording`, so a recorder armed from
inside `update` or `render` captures whole frames only. A frame that opened
while the recorder was armed and closes after `stopRecording` is dropped.

A frame is bracketed around the engine's frame preparation and the game's
`render`. The clear with its depth reset, the viewport fit, and the renderer
state in force are inside the bracket; the
[diagnostics](/engines/simple-3d/apis/diagnostics/) overlay draws on its own
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
| `format` | The format version, equal to `RECORDING_FORMAT`. |
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

`RECORDING_FORMAT` is the integer this engine writes. There is one recording
format and it is version `1`. `space: "3d"` is what tells the reviewer's
player to draw the document with the 3D drawer; a 2D recording carries no
`space` field, so absent means 2D and one player serves the recordings of every
engine. A player refuses a document whose `format` or `space` it does not know,
which is a document no recorder wrote.

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

`count`, `timeMs`, and `deltaMs` are the figures
[`FrameInfo`](/engines/simple-3d/apis/game/) carries for the same frame. They
and `surface` are the axis a reviewer scrubs on, so two recordings of one
scenario scrub in step on them.

There is no `stack` field. The scene context has no `save`/`restore`, no clip,
and no path machinery, so nothing beyond the renderer state survives a frame
boundary and nothing else needs carrying.

## `RenderState`

What survives a frame boundary is the renderer state: the camera, the lights,
and the render mode, each set through the scene context and holding until set
again. A frame's operations are its draw calls, any state-setting calls, and
any depth clears it issued; its inherited state is the renderer state in force
when it opened.

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
| `camera` | The [`CameraState`](/engines/simple-3d/apis/viewport/) in force at the top of the frame. |
| `lights` | The light list in force, at most 64 entries. |
| `mode` | The render mode in force. `"standard"` is the lit default. |

`Color` is a CSS color string, matching `background` and every other color the
engine takes. A fresh engine's renderer state is the defaults: the default
`CameraState`, an empty light list, and `"standard"`.

`lights` holds at most 64 entries. A frame that inherited a light list the
recorder cut down carries `truncated: true`, and a player reports the flag
beside everything else it could not reproduce, which is what lets a reviewer
tell a picture the format could not carry from one it carried.

The bound cuts the retained state rather than the operation. A recorded
`setLights` carries every light the build supplied, so a player re-issuing one
keeps the first 64 entries itself and inherits the list the engine inherited.

## `DrawOp`

```ts
type DrawOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };
```

| Field | Meaning |
| --- | --- |
| `method` | The method called. |
| `args` | The call's arguments, encoded as `DrawValue`. |
| `property` | The property assigned. |
| `value` | The value assigned, encoded as `DrawValue`. |

Every entry of `ops` is an operation performed on the scene context itself. The
scene context declares no assignable properties, so a conforming recording's
`ops` holds `call` entries only; `set` remains part of the format. A `set`
records the value the build supplied rather than a normalized form, and a
call's arguments are resolved before the call is issued.

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

A player draws an operation whose arguments resolve and reports one carrying an
`$opaque` value rather than substituting something else.

Encoding a value always terminates in one of these forms. A cyclic object and an
object whose getter throws each record as `{ $opaque: … }`, so a build draws the
same pixels whether or not anything is being captured.

Two bounds keep the encoding finite. The value an operation carries sits at
depth zero, and an array or plain object reached at depth 32 records as
`{ $opaque: … }` rather than being expanded. One encoded value also expands into
at most 65,536 values, counted over every value the walk reaches. A container
the expansion bound falls inside stops there and carries its remainder as a
single `{ $opaque: "truncated" }`: the last element of an array, and the field
named `$rest` of an object. Both bounds are part of the format rather than a
choice a recorder makes, so every recorder writing this format answers the same
input with the same document.

The structured values the scene context takes encode as their plain-data
shapes: a `Vec3` as `{ x, y, z }`, a `Quat` as `{ x, y, z, w }`, a `Transform`
as `{ position, rotation, scale }`, a `CameraState` and a `LightState` field by
field. A [handle](/engines/simple-3d/apis/assets/) encodes as `{ $asset: n }`.

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
once, however many frames draw it. Captured asset bytes, counted over `data`
and `src`, stop at 16 MB, and the bound is a ceiling rather than a threshold:
the capture that would take the holdings past it is the one refused, so 16 MB
is the most a document carries. Assets already captured keep resolving, and a
further new capture records `{ $opaque: "MeshHandle" }` — or the handle's own
type name — the same degradation a player already reports. An entry that fails
to decode at replay is skipped and reported.

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
producing call
belongs to the recipe of the value it made rather than to the frame, so `ops`
holds no producing call.

A produced value is immutable, so its recipe is its `make` with an empty
`then`, and its identity is the call that made it. A resource is captured at
the moment the value is used, two uses with the same arguments share one entry,
and a value that is created and never used is left out. Per-frame creation
therefore costs nothing in the recording.

The recorder collects a produced value's recipe from the moment the scene
context creates it, whether or not the recorder is armed, so a build that
creates its materials once and draws with them for the rest of its life records
every draw under the material it drew with. A recipe holds at most 1024
mutation steps, past which the value records as `{ $opaque: … }`; both rules
are the format's own.

## Numbers

Every number inside a `DrawValue`, a `RenderState`, or a resource recipe is
written to at most nine significant digits. Nine significant digits over a
design space of a thousand-odd units resolves far below what a picture shows,
so the digits past that describe the arithmetic that produced a coordinate
rather than the picture it draws.

The frame metadata is exact. `count`, `timeMs`, `deltaMs`, and `surface` are
the axis a reviewer scrubs on and the surface a frame was drawn into, and both
are compared against figures a check asserts.

## Drawing a frame

Every frame is drawn from itself alone:

1. Blank the context: clear to `background` (transparent when `null`) at the
   frame's `surface` size, with the depth state reset.
2. Apply `states[frame.state]`: the mode, the camera, then the lights.
3. Issue each of `frame.ops` in order, resolving each `$asset` against the
   decoded asset table and each `$res` on demand through its recipe.

A `$res` is built by issuing `make` against the scene being drawn into and
applying each entry of `then` to what came back, and a built resource is reused
for the rest of that frame. An operation carrying an `$opaque` value, naming an
asset that failed to decode, or naming a resource that failed to build is
skipped and reported, so a replay accounts for every operation it leaves out.

Every reference a frame carries, including every reference in its inherited
state, resolves from the recording's own tables. Seeking to a frame therefore
costs what drawing it costs.

Frame independence is exact, with no exceptions clause. There is no save stack,
no clip, and no `putImageData`: the renderer state a frame inherits is three
values, every draw call is self-contained, and a frame drawn by itself is the
frame that was on screen.

## Exports

`Recording`, `RecordedFrame`, `RenderState`, `RenderMode`, `LightState`,
`Color`, `DrawOp`, `DrawValue`, `CapturedAsset`, `Resource`, and `ResourceOp`
are exported as types from `@test-cabinet/simple-3d`, and `RECORDING_FORMAT` is
exported as a value from the same entry point.
