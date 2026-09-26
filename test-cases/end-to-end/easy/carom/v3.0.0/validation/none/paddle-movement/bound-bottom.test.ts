// paddle-movement/bound-bottom — a paddle driven into the bottom bound stops there.
//
// specs/playfield.md: a paddle's center is clamped to
// [`PADDLE_MIN_CY`, `PADDLE_MAX_CY`], and every mover integrates the same way:
// `next = clamp(cy + vy * dt, ...)`; if the clamp changed the value,
// `vy = (next - cy) / dt`. A paddle pinned against a bound therefore reports
// `cy` exactly at the bound and `vy = 0` while the movement is still held into
// it. The match is opened through the debug surface, which takes NEITHER paddle
// from the player — only `setPaddleDriven` does that, and nothing here calls it
// (specs/instrumentation.md) — so the held key reaches the build without a menu
// key being pressed on the way. It is held, through Chromium's own input
// pipeline, for longer than the paddle needs to reach the bound from center (305
// units at 720 per second is 0.42 s), and both readings are taken with the key
// still down.
//
// THE FIELD IS EMPTIED FIRST. A bound is about the paddle and the key driving it
// into the bound, so the ball and the obstacles come off the field: nothing can
// arrive at the paddle while it sits pinned, and the clip a reviewer watches is
// the travel into the bound and the stop.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { PADDLE_MAX_CY } from "../constants";
import {
  captureReplay,
  clearField,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** Long enough to reach the bound from center, with the key held on into it. */
const HELD_TICKS = 72; // 0.6 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("stops at PADDLE_MAX_CY with vy 0 while the key is held into the bound", async () => {
  await startPlaying(harness, "solo");
  await clearField(harness);

  const pinned = await captureReplay(harness, "bound", async () => {
    await harness.hold("KeyS");
    await harness.advance(HELD_TICKS);
    const read = (await harness.snapshot()).paddles.left;
    await harness.release("KeyS");
    return read;
  });

  assertCloseTo(pinned.cy, PADDLE_MAX_CY, 6);
  assertCloseTo(pinned.vy, 0, 6);
});
