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
records the section of a run it cares about and pays nothing for the rest.
Nothing accumulates while the recorder is idle.

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
  frames: readonly RecordedFrame[];
}
```

| Field | Meaning |
| --- | --- |
| `format` | The format version, `RECORDING_FORMAT`. A player checks it before drawing anything. |
| `width` | The logical design width the operations were issued in. |
| `height` | The logical design height the operations were issued in. |
| `background` | The color each frame was cleared to, or `null` for transparency. |
| `frames` | The frames captured, in order. |

`RECORDING_FORMAT` is exported from `@test-cabinet/simple-2d`, alongside every
type on this page.

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

`count` and `timeMs` are the same figures `engine.frame()` reports, so a frame
in a recording is identified by the counter a check asserts against. See
`frame.md`.

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
| `transform` | The transform as `[a, b, c, d, e, f]`, or `null` when the context could not report one. |
| `lineDash` | The dash pattern, or `null` when the context could not report one. |

A property the context does not carry is omitted, so `properties` holds whatever
that context was able to report rather than a fixed list.

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
| `target` | Absent for an operation the context performed; an interned id for one performed on a value the context returned. |
| `method` | The method called, for a `call`. |
| `args` | The call's arguments, encoded as `DrawValue`. |
| `id` | Present when the call produced a value later operations refer to. |
| `property` | The property assigned, for a `set`. |
| `value` | The value assigned, encoded as `DrawValue`. |

A `set` records the value the build supplied rather than the value the context
normalized it to, so a color written as `#fff` records as `#fff`.

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

Plain data travels as itself. `{ $ref: n }` names the value interned with id
`n`, created by the operation that carried `id: n`, which is how a gradient
created through the context and then given color stops replays as the same
gradient.
`{ $opaque: "Name" }` names a value the recorder could not carry, so a player
reports the operation it cannot reproduce instead of drawing something else.

## Every frame stands alone

A frame carries the context state it inherited, so drawing it needs nothing from
the frames before it. Applying `frame.state` and then replaying `frame.ops` in
order draws exactly the frame the build drew:

1. Assign each entry of `state.properties`.
2. Apply `state.transform`, when it is present.
3. Apply `state.lineDash`, when it is present.
4. Replay `frame.ops` in order.

This is what makes seeking to any frame a constant-time operation, and what lets
two recordings of the same scenario be scrubbed side by side in step.

## Storing a recording

A recording is stored and served gzipped, under both extensions:
`<name>.json.gz`. The property that makes every frame stand alone is what makes
this worth doing. Each frame restates the drawing state it inherited and issues
very nearly the operations its neighbours did, so the document is repetitive by
design and compresses to a small fraction of its size. A real capture stores tens
of times smaller gzipped.

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
