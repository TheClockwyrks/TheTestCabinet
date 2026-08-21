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

| Member | Returns | Behavior |
| --- | --- | --- |
| `recording()` | `boolean` | Whether operations are being captured. |
| `startRecording()` | `void` | Arms the recorder. Capture begins at the next frame. |
| `stopRecording()` | `Recording` | Disarms the recorder and returns everything captured since `startRecording`. |

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
  frames: readonly RecordedFrame[];
}
```

| Field | Meaning |
| --- | --- |
| `format` | The format version, equal to `RECORDING_FORMAT`. |
| `width` | The logical design width the operations were issued in. |
| `height` | The logical design height the operations were issued in. |
| `background` | The CSS color each frame was cleared to, or `null` for transparency. |
| `frames` | The frames captured, in order. |

`RECORDING_FORMAT` is the integer this engine version writes. It is bumped
whenever the meaning of anything below changes, independently of the engine
package's own version, and a player reads it first so it can refuse a recording
it does not know how to draw.

## `RecordedFrame`

```ts
interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  state: DrawState;
  ops: readonly DrawOp[];
}
```

| Field | Meaning |
| --- | --- |
| `count` | The engine's frame counter at this frame. |
| `timeMs` | Accumulated simulated time through this frame, in milliseconds. |
| `deltaMs` | What this frame was worth, in milliseconds. |
| `surface` | The canvas backing store this frame was drawn into, in device pixels. |
| `state` | The context state this frame inherited, before its own operations. |
| `ops` | The operations this frame issued, in order. |

`count`, `timeMs`, and `deltaMs` are the figures
[`FrameInfo`](/engines/simple-2d/apis/game/) carries for the same frame.

## `DrawState`

```ts
interface DrawState {
  properties: Readonly<Record<string, DrawValue>>;
  transform: readonly number[] | null;
  lineDash: readonly number[] | null;
}
```

| Field | Meaning |
| --- | --- |
| `properties` | The style properties in force at the top of the frame, by name. |
| `transform` | The transform as `[a, b, c, d, e, f]`, or `null` when the context reported none. |
| `lineDash` | The dash pattern, or `null` when the context reported none. |

`properties` covers the canvas state that survives a frame boundary: the alpha,
the composite operation, the filter, the image smoothing, the stroke and fill
styles, the shadow, the line settings, and the text settings. A property the
context does not carry, or refuses to report, is omitted, so the same recorder
runs over a browser context and over the native canvas a validator builds on.

## `DrawOp`

```ts
type DrawOp =
  | {
      op: "call";
      target?: number;
      method: string;
      args: readonly DrawValue[];
      id?: number;
    }
  | { op: "set"; target?: number; property: string; value: DrawValue };
```

| Field | Meaning |
| --- | --- |
| `target` | Absent for an operation performed on the context; the interned id of the value the operation was performed on otherwise. |
| `method` | The method called. |
| `args` | The call's arguments, encoded as `DrawValue`. |
| `id` | Present when the call produced a value later operations refer to, and is the id they name. |
| `property` | The property assigned. |
| `value` | The value assigned, encoded as `DrawValue`. |

A `set` records the value the build supplied rather than the value the context
normalized it to, so a color written as `#fff` records as `#fff` and the
recording states what the build did.

## `DrawValue`

```ts
type DrawValue =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue[]
  | { readonly $ref: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue };
```

| Form | Meaning |
| --- | --- |
| `null`, `boolean`, `number`, `string` | The value itself. |
| Array | Each entry encoded in turn. |
| `{ $ref: n }` | The value interned with id `n`, created by the operation that carried `id: n`. |
| `{ $opaque: "Name" }` | A value the recorder could not carry, named by its constructor. |
| Object | A plain object, encoded field by field. |

A player draws an operation whose arguments resolve and reports one carrying an
`$opaque` value rather than substituting something else.

## Replaying a frame

Every frame is drawn from itself alone:

1. Assign each entry of `frame.state.properties` to the context.
2. Apply `frame.state.transform` when it is present.
3. Apply `frame.state.lineDash` when it is present.
4. Replay `frame.ops` in order, resolving `$ref` against the values earlier
   operations in the same frame produced.

No earlier frame takes part, so seeking to a frame costs what drawing it costs.

## Exports

`Recording`, `RecordedFrame`, `DrawState`, `DrawOp`, and `DrawValue` are
exported as types from `@test-cabinet/simple-2d`, and `RECORDING_FORMAT` is
exported as a value from the same entry point.
