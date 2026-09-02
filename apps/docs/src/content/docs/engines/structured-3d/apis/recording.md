---
title: Recording
---

A recording is a video of the frames the engine drew. Armed, the recorder
captures the stage canvas's pixels once per engine frame, with the screen layer
over them, and encodes the frames with the browser's WebCodecs `VideoEncoder`
as VP9 in a WebM container. What the recording holds is exactly what the
pipeline drew: every material, shader, shadow, fog, sprite, post-effect, and
screen-space component, because the evidence is the pixels. The recorder is
part of the engine, armed and disarmed through the
[`Engine`](/engines/structured-3d/apis/engine/) object.

## Engine members

```ts
recording(): boolean;
startRecording(): void;
stopRecording(): Promise<Recording>;
```

| Member | Returns | Behavior |
| --- | --- | --- |
| `recording()` | `boolean` | Whether frames are being captured. |
| `startRecording()` | `void` | Arms the recorder. Capture begins at the next frame. |
| `stopRecording()` | `Promise<Recording>` | Disarms the recorder, flushes the encoder, and resolves with everything captured since `startRecording`. |

`stopRecording` is asynchronous because the encoder is flushed before the
container is closed, and the promise resolves once the last frame's bytes are
in it. `engine.destroy()` while the recorder is armed discards the capture.

## `Recording`

```ts
interface Recording {
  video: Uint8Array;
  width: number;
  height: number;
  frames: readonly RecordedFrame[];
  ended: boolean;
}
```

| Field | Meaning |
| --- | --- |
| `video` | The WebM bytes. |
| `width`, `height` | The frame size in device pixels. |
| `frames` | One entry per video frame, in order. |
| `ended` | `true` when the [frame bound](#the-frame-bound) stopped capture before `stopRecording`. |

`frames.length` is the number of video frames the container holds, so a suite
reads the frame count from it and a player indexes the video's frames by it.

## `RecordedFrame`

```ts
interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
}
```

| Field | Meaning |
| --- | --- |
| `count` | The engine's frame counter for this frame. |
| `timeMs` | The engine's accumulated simulated time through this frame, in milliseconds. |
| `deltaMs` | What the frame was worth, in milliseconds. |

The three are the frame's `count`, `timeMs`, and `lastDeltaMs` as the engine's
[`FrameInfo`](/engines/structured-3d/concepts/frame/) reported them, kept
beside the video so a frame in the recording is addressable by the engine's
counter and by simulated time. The engine's counter and accumulated time
survive every level transition, so a recording that spans a transition stays
addressable throughout.

## Frame boundaries

Capture begins at the frame after `startRecording`, so a recorder armed from
inside a tick or a `DrawComponent`'s `draw` captures whole frames only. A frame
open when `stopRecording` is called is dropped.

The recorder captures the frame after the pipeline's world pass has rendered
and the screen-space components have drawn, and before the diagnostics overlay
draws on the screen layer. In the engine's
[frame order](/engines/structured-3d/concepts/frame/#frame-order) that is the
step between the screen pass and the overlay, so a recording holds the picture
the game submitted and nothing of the overlay.

## What a frame is

A frame is the picture the game submitted: the scene rendered through the
camera plus the screen layer over it. Everything the
[pipeline](/engines/structured-3d/apis/rendering/) drew is in it: the
`background` and the letterbox bars, the world pass under the render mode in
force, the collision overlay when it is enabled, every screen-space component,
and whatever a `DrawComponent` drew through `DrawApi.ctx`. The render modes and
the collision overlay are in the frame because the renderer drew them, and the
diagnostics overlay is outside it.

The recorder composes the frame itself. After the world pass has rendered and
the screen-space components have drawn, it draws the stage canvas and then the
screen layer into a capture canvas of the recording's size, and hands that
canvas to the encoder as a `VideoFrame`. The encoder discards alpha, so
wherever the composed picture is transparent the frame shows black.

The recording's size is the stage canvas's backing store when the recorder is
armed, and `Recording.width` and `height` report it. A frame whose backing
store differs is drawn scaled into the capture canvas, so every frame in one
recording has the same size.

## Encoding

Frames are encoded as VP9 by a WebCodecs `VideoEncoder` and written into a WebM
container. The encoder emits a keyframe at least every 60 frames, and the first
frame of a recording is a keyframe.

Each video frame's timestamp is the engine's accumulated simulated time through
that frame, `RecordedFrame.timeMs`, in microseconds, rounded to the nearest
microsecond. A frame whose simulated time equals the previous frame's is timed
one microsecond after it, so timestamps strictly increase and every frame is
addressable by its own. A player decodes with a WebCodecs `VideoDecoder`,
indexes the frames by timestamp, and seeks by decoding forward from the nearest
earlier keyframe, which costs at most 60 frames of decode.

## The frame bound

Capture stops at 3,600 frames. `Recording.ended` is `true` when that bound
stopped it, the recorder stays armed until `stopRecording`, and every frame the
recording holds is whole.

While idle the recorder costs nothing per frame.

## Errors

| Condition | Result |
| --- | --- |
| `startRecording` while already armed | `Error` naming the unbalanced call |
| `stopRecording` while not armed | `Error` naming the unbalanced call |
| `startRecording` where the host has no `VideoEncoder` | `Error` naming WebCodecs |
| `engine.destroy()` while armed | The capture is discarded and the recorder is disarmed |

## Exports

`Recording` and `RecordedFrame` are exported as types from
`@test-cabinet/structured-3d`.
