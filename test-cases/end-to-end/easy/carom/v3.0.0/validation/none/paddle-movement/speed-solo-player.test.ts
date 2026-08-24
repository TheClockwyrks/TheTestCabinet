// paddle-movement/speed-solo-player — the human paddle's speed in Solo.
//
// specs/playfield.md: a human-controlled paddle moves at `PADDLE_SPEED` (720
// units per second) while a movement action is held. The match is started from
// the title with menu keys, so the game stays under normal player control, and
// the key is pressed through Chromium's own input pipeline the way a player's
// is. The displacement over a window of held frames is measured back into a
// speed. The window opens a few frames after the press, so it reads a paddle in
// steady travel rather than the frame the press was first seen on, and a
// paddle that integrates `vy * dt` exactly covers `PADDLE_SPEED * window`; two
// percent is rounding room on that.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { PADDLE_SPEED } from "../constants";
import {
  captureReplay,
  createHarness,
  holdMove,
  speedOverTicks,
  startWithKeys,
  type Harness,
} from "../harness";

const SPEED_TOLERANCE = PADDLE_SPEED * 0.02;
const TICKS = 36; // 0.3 s
const LEAD_TICKS = 6; // 0.05 s of the key down before the window opens

/** Frames recorded either side of the hold, for the replay's context. */
const REST_TICKS = 12; // 0.1 s at rest before the hold
const SETTLED_TICKS = 24; // 0.2 s at rest after the release

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("moves the human paddle at the paddle speed while KeyS is held", async () => {
  await startWithKeys(harness, "solo");

  const moved = await captureReplay(harness, "move", async () => {
    await harness.advance(REST_TICKS);
    const held = await holdMove(harness, "left", "KeyS", {
      ticks: TICKS,
      leadTicks: LEAD_TICKS,
    });
    await harness.advance(SETTLED_TICKS);
    return held;
  });

  assertGreaterThan(moved.delta, 0);
  assertLessThanOrEqual(
    Math.abs(speedOverTicks(moved.delta, TICKS) - PADDLE_SPEED),
    SPEED_TOLERANCE,
  );
});
