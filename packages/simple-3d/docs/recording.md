# Recording

A recording is a **video** of the frames the engine drew. Armed, the recorder
captures the stage canvas's pixels once per engine frame, with the screen layer
over them, and encodes them with the browser's WebCodecs `VideoEncoder` as VP9
in a WebM container. Because the evidence is the pixels, everything the renderer
drew is in it: every material, shader, shadow, fog, sprite, post-effect, and HUD
operation.

```ts
engine.recording(): boolean;
engine.startRecording(): void;
engine.stopRecording(): Promise<Recording>;
```

| Member           | Effect                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------- |
| `recording`      | Whether frames are being captured right now.                                            |
| `startRecording` | Arm the recorder. Capture begins at the next frame.                                     |
| `stopRecording`  | Disarm, flush the encoder, and resolve with everything captured since `startRecording`. |

A build does not arm the recorder itself. It is armed by whoever owns the engine
— a case's checks, around the stretch of a scenario a check is about — and the
build's part is to draw everything it means to show through `api.scene`,
`api.camera`, and `api.screen`, because those are what the capture holds.

## Arming the recorder

```ts
const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
  game,
  clock: new ConstantClock(1000 / 60),
});
await engine.initialize();

await engine.advance(60); // setup, not captured
engine.startRecording();
await engine.advance(120); // the 120 frames the recording holds
const recording = await engine.stopRecording();
```

Capture begins at the frame **after** `startRecording`, so a caller that arms
the recorder from inside `update` or `render` records whole frames only. A frame
open when `stopRecording` is called is dropped. `stopRecording` is asynchronous
because the encoder is flushed before the container is closed, and the promise
resolves once the last frame's bytes are in it.

While idle the recorder costs nothing per frame.

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

| Field             | Meaning                                                             |
| ----------------- | ------------------------------------------------------------------- |
| `video`           | The WebM bytes.                                                     |
| `width`, `height` | The frame size in device pixels.                                    |
| `frames`          | One entry per video frame, in order.                                |
| `ended`           | `true` when the frame bound stopped capture before `stopRecording`. |

`frames.length` is the number of video frames the container holds, so a check
reads the frame count from it and a player indexes the video's frames by it.

## `RecordedFrame`

```ts
interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
}
```

| Field     | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `count`   | The engine's frame counter for this frame.                                   |
| `timeMs`  | The engine's accumulated simulated time through this frame, in milliseconds. |
| `deltaMs` | What the frame was worth, in milliseconds.                                   |

The three are the frame's `count`, `timeMs`, and `lastDeltaMs` as `FrameInfo`
reported them, kept beside the video because the video carries the pixels and
nothing about the run that produced them. A check that knows the simulation
reached its interesting moment on frame 240 finds that frame in the container by
index, and a player seeking by simulated time has the timestamp the encoder was
given.

## What a frame is

A frame is the picture the game submitted: the scene rendered through the camera
plus the screen layer over it. The `background` color and the letterbox bars are
in it; the diagnostics overlay is not.

The recorder captures in step 8 of the frame — after the scene is rendered and
the screen layer drawn, and before the overlay draws on that layer — so a
recording holds the picture the game submitted whether or not the overlay was
visible. See `frame.md` for the eleven steps.

The recorder composes the frame itself: it draws the stage canvas and then the
screen layer into a capture canvas of the recording's size and hands that canvas
to the encoder as a `VideoFrame`. The encoder discards alpha, so wherever the
composed picture is transparent the frame shows black — a build that wants a
recorded backdrop sets `background`, `scene.background`, or both.

The recording's size is the stage canvas's backing store when the recorder is
armed, and `Recording.width` and `height` report it. A frame whose backing store
differs, after a resize part way through, is drawn scaled into the capture
canvas, so every frame in one recording has the same size.

## Encoding and timing

Frames are encoded as VP9 and written into a WebM container. The encoder emits a
keyframe at least every 60 frames, and the first frame of a recording is a
keyframe, so a seek to any frame decodes forward from the nearest earlier
keyframe and costs at most 60 frames of decode.

Each video frame's timestamp is the engine's accumulated **simulated** time
through that frame, `RecordedFrame.timeMs`, in microseconds, rounded to the
nearest microsecond. A frame whose simulated time equals the previous frame's is
timed one microsecond after it, so timestamps strictly increase and every frame
is addressable by its own.

Simulated time is the sum of the deltas the clock delivered, so a timestamp says
where in the scenario a frame belongs rather than when the machine happened to
draw it. Two recordings of the same scenario under the same scripted clock carry
the same timestamps, which is what lets a build's recording and the reference
implementation's be scrubbed side by side in step, one control moving both.

## The frame bound

Capture stops at 3,600 frames. `Recording.ended` is `true` when that bound
stopped it, the recorder stays armed until `stopRecording`, and every frame the
recording holds is whole. A check recording a long section reads `ended` to know
whether the evidence covers the whole of it.

## What the recording holds

The recording holds the pixels of the canvas the engine drew. A build that draws
to a surface of its own, outside `api.scene` and `api.screen`, draws outside the
recording. Everything submitted through the two surfaces the engine owns is
captured exactly as the renderer drew it.

## Errors

| Condition                                             | Result                                                |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `startRecording` while already armed                  | `Error` naming the unbalanced call                    |
| `stopRecording` while not armed                       | `Error` naming the unbalanced call                    |
| `startRecording` where the host has no `VideoEncoder` | `Error` naming WebCodecs                              |
| `engine.destroy()` while armed                        | The capture is discarded and the recorder is disarmed |

Both unbalanced calls refuse rather than proceed, because the mistake is always
an unbalanced call and an empty recording handed back from one reads as a build
that drew nothing.
