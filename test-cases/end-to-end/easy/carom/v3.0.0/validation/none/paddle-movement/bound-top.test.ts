// paddle-movement/bound-top — a paddle driven into the top bound stops there.
//
// specs/playfield.md: a paddle's center is clamped to
// [`PADDLE_MIN_CY`, `PADDLE_MAX_CY`], and every mover integrates the same way:
// `next = clamp(cy + vy * dt, ...)`; if the clamp changed the value,
// `vy = (next - cy) / dt`. A paddle pinned against a bound therefore reports
// `cy` exactly at the bound and `vy = 0` while the movement is still held into
// it. The match is started with menu keys and the key is held, through
// Chromium's own input pipeline, for longer than the paddle needs to reach the
// bound from center (305 units at 720 per second is 0.42 s), and both are read
// with the key still down.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_MIN_CY } from "../constants";
import {
  captureReplay,
  createHarness,
  startWithKeys,
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

it("stops at PADDLE_MIN_CY with vy 0 while the key is held into the bound", async () => {
  await startWithKeys(harness, "solo");

  const pinned = await captureReplay(harness, "bound", async () => {
    await harness.hold("KeyW");
    await harness.advance(HELD_TICKS);
    const read = (await harness.snapshot()).paddles.left;
    await harness.release("KeyW");
    return read;
  });

  expect(pinned.cy).toBeCloseTo(PADDLE_MIN_CY, 6);
  expect(pinned.vy).toBeCloseTo(0, 6);
});
