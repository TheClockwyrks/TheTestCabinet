# Recording

A recording is the operations the rendering pipeline issued against the scene
context, frame by frame, in the order it issued them. Re-issuing one against
another scene context reproduces the picture the build drew, so a scenario can
be handed to a reviewer as the build's own drawing rather than as a re-shoot of
it.

The recorder wraps the scene context the pipeline draws through. The built-in
render components, the collision overlay, and a `DrawComponent`'s `api.scene`
all draw through that context, so the whole picture is recorded.

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
shadows the scene context whether it is armed or not, because a frame inherits
renderer state and produced values established long before arming.

```ts
const engine = createEngine({ canvas, width: 640, height: 360, game });
await engine.initialize();

await engine.advance(60);        // setup, not captured
engine.startRecording();
await engine.advance(120);       // the 120 frames the recording holds
const recording = engine.stopRecording();
```

Capture begins at the next frame rather than part-way through the current one,
so a caller that arms the recorder from inside a tick or a `DrawComponent`'s
`draw` records whole frames only. A frame that opened while the recorder was
armed and closes after `stopRecording` is dropped.

A frame is bracketed around the engine's frame preparation and the pipeline's
drawing. The clear with its depth reset, the viewport fit, the frame's
renderer-state sets — the mode, the camera, and the lights — every render
component's draws, and the collision overlay are inside the bracket, because the
collision overlay is a render switch the pipeline draws. The diagnostics
overlay, drawn on the engine's own 2D overlay surface, is outside it and never
enters a recording.

The design size and background a recording reports are fixed when the recorder
is armed, taken from the engine's own `EngineOptions` rather than read back from
the canvas when the recording is closed.

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

There is one recording format and it is version `1`. `space: "3d"` is what tells
the reviewer's player to draw the document with the 3D drawer; a 2D recording
carries no `space` field, so an absent field means 2D and one player serves
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

`count`, `timeMs`, and `deltaMs` are the figures `FrameInfo` carries for the
same frame. They are carried exact, because they are the axis a reviewer scrubs
on: two recordings of one scenario scrub in step on them, a 2D and a 3D
recording included.

There is no `stack` field. The scene context has no `save` and `restore`, so no
stack of saved states exists to survive a frame boundary.

## `RenderState`

The scene context has no save stack and no clip or path machinery. What survives
a frame boundary is the renderer state: the camera, the lights, and the render
mode, each set through the scene context and holding until set again. A frame's
operations are its draw calls, any state-setting calls, and any depth clears it
issued, and its inherited state is the renderer state in force when it opened.

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
| `camera` | The camera in force at the top of the frame, as a `CameraState`. |
| `lights` | The light list in force, at most 64 entries. |
| `mode` | The render mode in force. |

`Color` is a CSS color string, matching `background` and every component color.
A fresh engine's renderer state is the defaults: the default `CameraState`, an
empty light list, `"standard"`.

The pipeline sets all three at the top of every frame — the mode from
`engine.renderer`, the camera from `world.camera`, and the lights snapshotted
from the enabled light components or the default rig — so a recording states
what framed and lit each of its frames.

`lights` holds at most 64 entries. A frame that inherited a longer list the
recorder cut down carries `truncated: true`, and a player reports the flag
beside everything else it could not reproduce, which is what lets a reviewer
tell a picture the format could not carry from one it carried.

## `DrawOp`

```ts
type DrawOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };
```

Every entry of `ops` is an operation performed on the scene context itself:
`method` is a scene context method and `property` a scene context property. The
vocabulary is the scene context's ten verbs — the three state setters,
`clearDepth`, and the six draw calls — shared with `simple-3d`, so one player
draws both engines' recordings. The call that produced a geometry or a material,
and every operation performed on that value afterwards, belong to its `Resource`
recipe instead, so a player issues each operation against the context it is
drawing into and has nothing else to dispatch on.

The scene context declares no assignable properties, so a conforming recording's
`ops` holds `call` entries alone; `set` remains part of the format.

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

Structured values encode as their plain-data shapes: a `Vec3` as `{ x, y, z }`,
a `Quat` as `{ x, y, z, w }`, a `Transform` as `{ position, rotation, scale }`,
a `CameraState` and a `LightState` field by field. A handle encodes as `{
$asset: n }`.

Encoding a value always terminates in one of these forms. A cyclic object and an
object whose getter throws each record as `{ $opaque: … }`, so a build draws the
same pixels whether or not anything is being captured.

Two bounds keep the encoding finite. The value an operation carries sits at
depth zero, and an array or plain object reached at depth 32 records as `{
$opaque: … }` rather than being expanded. One encoded value also expands into at
most 65,536 values, counted over every value the walk reaches; a container the
bound falls inside stops there and carries its remainder as a single `{ $opaque:
"truncated" }`, the last element of an array and the field named `$rest` of an
object. Both bounds are part of the format rather than a choice a recorder
makes, so every recorder writing this format answers the same input with the
same document.

## `CapturedAsset`

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

The assets the operations draw with are carried inside the recording, so a
replay needs nothing from the run's tree. A handle is immutable and loaded once,
so it is keyed on identity and captured once, however many frames draw it.

A texture the engine rasterized itself — a `TextComponent`'s billboard — is
captured the same way, as a `texture` entry whose `path` is `text:` followed by
the string, so a player draws the lettering from the captured pixels without
owning the face.

Capture stops once the recording holds 16 MB of asset bytes, counted over `data`
and `src`. Captured assets keep resolving, and a further new capture records `{
$opaque: "MeshHandle" }` or the handle's type name, the same degradation a
player already reports. An entry that fails to decode at replay is skipped and
reported.

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

A resource is a value the scene context produced: procedural geometry and
materials created in code, through the six producing methods `createBox`,
`createSphere`, `createCylinder`, `createCapsule`, `createPlane`, and
`createMaterial`. A producing call belongs to the recipe of the value it made
rather than to the frame, so `ops` holds no producing call.

A resource is captured at the moment the value is used, with the mutations
applied up to that point. A produced value is immutable, so its recipe is its
`make` with an empty `then`; the mutation machinery remains part of the shared
format, and a recipe holds at most 1024 steps, past which the value records as
`{ $opaque: … }`. Two uses of the same value with the same history name the same
resource, and a value that is created and never used is left out.

The recorder collects a produced value's recipe from the moment the scene
context creates it, whether or not the recorder is armed, so a build that
creates its geometries once at startup and draws with them for the rest of its
life records every draw under the geometry it drew. Creation is deterministic,
and two producing calls with the same arguments share one entry.

## Numbers

Every number inside a `DrawValue`, a `RenderState`, or a resource recipe is
written to at most nine significant digits. Nine significant digits resolve a
coordinate far below a pixel, so the digits past that describe the arithmetic
that produced it rather than the picture it draws.

The frame metadata is exact. `count`, `timeMs`, `deltaMs`, and `surface` are the
axis a reviewer scrubs on and the surface a frame was drawn into, and both are
compared against figures a check asserts.

## Every frame stands alone

Every frame is drawn from itself alone:

1. Blank the context: clear to `background` (transparent when `null`) at the
   frame's `surface` size, with the depth state reset.
2. Apply `states[frame.state]`: the mode, the camera, then the lights.
3. Issue each of `frame.ops` in order, resolving `$asset` against the decoded
   asset table and `$res` on demand through its recipe.

A `$res` is built by issuing `make` against the context being drawn into and
applying each entry of `then` to what came back, and the built value is reused
for the rest of that frame. An operation carrying an `$opaque` value, naming an
asset that failed to decode, or naming a resource that failed to build is
skipped and reported, so a replay accounts for every operation it leaves out.

Every reference a frame carries, including every reference in its inherited
state, resolves from the recording's own tables, so seeking to a frame costs
what drawing it costs. There is no save stack, no clip region, and no pixel
write that bypasses the recorded operations, so **frame independence carries no
exceptions**: a player lands on any frame and draws exactly the picture that was
on screen at that moment.

## What a recording holds

A recording holds the operations issued through the scene context the pipeline
draws through. A `DrawComponent` that draws to a surface of its own draws
outside the recording, and a frame that emits no operations while its pixels
change is the signal that it did. Draw through `DrawApi.scene` and everything a
frame drew is captured.

## The `./recording` subpath

```ts
import { RECORDING_FORMAT } from "@test-cabinet/structured-3d/recording";
import type { Recording, RecordedFrame } from "@test-cabinet/structured-3d/recording";
```

The subpath serves `RECORDING_FORMAT` and every type on this page as a leaf
module, loadable with no engine and no DOM, which is what a player that only
reads recordings imports. The package root exports the same names, so a build
that already imports the engine needs nothing else.

## Errors

| Condition | Result |
| --- | --- |
| `startRecording` while already recording | `Error` naming the unbalanced call |
| `stopRecording` while not recording | `Error` naming the unbalanced call |

Both refuse rather than proceed, because the mistake is always an unbalanced
call and an empty recording handed back from one reads as a build that drew
nothing.
