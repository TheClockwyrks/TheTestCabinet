---
title: Recording
---

The engine records the picture it draws. Armed, it keeps every frame the
pipeline produced with the screen layer over it, as a video of the build's own
picture. A reviewer sees that picture beside the same scenario driven against
the reference implementation. The
[API page](/engines/structured-3d/apis/recording/) fixes the members, the
types, and the encoding; this page explains the shape.

## A recording is a video

A recording is a video of the frames the engine drew: the stage canvas's
pixels, one video frame per engine frame, encoded with the browser's WebCodecs
`VideoEncoder` as VP9 in a WebM container. Because the evidence is the pixels,
everything the pipeline drew is in it, every material, shader, shadow, fog,
sprite, post-effect, and screen-space component, and a player shows it as
decoded.

## What a frame is, and when it is taken

A frame is the picture the game submitted: the scene rendered through the
camera plus the screen layer over it, and nothing of the diagnostics overlay.
The recorder captures the frame after the pipeline's world pass has rendered
and the screen-space components have drawn, and before the diagnostics overlay
draws on the screen layer. It composes the frame itself, drawing the stage
canvas and then the screen layer into a capture canvas of the recording's size
and handing that canvas to the encoder.

The render mode in force and the collision overlay are in the frame because
the renderer drew them, so a recording taken under `wireframe` shows the edges
the mode substituted and one taken with the overlay on shows each collider's
shape. A `DrawComponent`'s drawing is in the frame for the same reason: it
draws on the screen layer in its place in the screen pass, and the screen
layer is part of the picture. A reviewer who wants the build's picture alone
records under `shaded` with the overlay off.

The recording's size is the stage canvas's backing store when the recorder is
armed. A frame drawn at another size is scaled into the capture canvas, so a
recording is one size throughout.

## Timing and keyframes

Each video frame is timestamped with the engine's accumulated simulated time
through that frame, in microseconds, and a frame whose simulated time equals
the previous frame's is timed one microsecond after it. Simulated time is the
sum of the deltas the clock delivered, so the timestamp says where in the
scenario a frame belongs rather than when the machine happened to draw it. Two
recordings of the same scenario under the same scripted clock therefore carry
the same timestamps, and a frame in one names its counterpart in the other.

The engine's accumulated time is the timestamp's source, and it survives every
level transition where `world.time` restarts at zero. A recording that spans a
transition therefore keeps one monotonic timeline, and the frame that opens
the incoming level sits at its own simulated time on it.

The encoder emits a keyframe at least every 60 frames. A keyframe is decodable
on its own, and every other frame is decodable from the keyframe before it, so
a seek to any frame decodes forward from the nearest earlier keyframe and costs
at most 60 frames of decode. That is what makes stepping frame-exact: a player
decodes with a WebCodecs `VideoDecoder`, indexes the frames by timestamp, and
lands on the frame asked for.

## The bracket and the frame bound

Capture begins at the frame after the recorder is armed and ends with the last
whole frame before it is disarmed, so a recording holds whole frames only. The
diagnostics overlay draws after the capture, so it is outside every recording,
and a recording shows the picture as the game submitted it whether or not the
overlay was visible.

Capture stops at 3,600 frames, and a recording that reached the bound says so
in `ended`. Every frame it holds is whole, and the recorder stays armed until
its owner disarms it, so a suite that records a long section reads `ended` to
know whether the evidence covers the whole of it.

## Armed around a section, idle otherwise

The recorder is armed and disarmed by whoever owns the engine, so a check
records the section of a scenario it is about and pays nothing for the setup
that got there. While idle the recorder costs nothing per frame. Disarming
flushes the encoder before the recording is handed back, which is why
disarming is asynchronous.

## Two recordings scrubbed in step

A build's recording and the baseline's are timestamped in the same simulated
time, so the review page indexes both by timestamp and one control scrubs the
two in step. A scenario that runs the same number of frames under the same
scripted clock in both places puts the two pictures on the same frame
throughout, and a frame where the build diverged from the reference sits beside
the reference frame it should have matched.
