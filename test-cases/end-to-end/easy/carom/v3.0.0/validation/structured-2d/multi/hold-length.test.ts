// multi/hold-length — the opening hold lasts the specified 1.0 s.
//
// The opening is measured FROM THE TITLE with menu keys, and nothing is posed or
// removed on the way: the world the check counts through is the one the build's
// own match start made, because every operation that would tidy it — spawning a
// ball, clearing the field — restarts the very timer being measured. The
// obstacles stay for the same reason, and a waiting ball touches neither. The
// hold is stepped ONE FRAME AT A TIME, so at the harness's 120 Hz clock the count
// is the duration.
//
// THE HOLD A SCORED BALL TAKES is `gameplay/relaunch-hold`'s point. The two are
// the same duration read at two moments, and a build that opens correctly and
// then relaunches instantly is a different fault from one that never holds at
// all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startWithKeys,
  type Harness,
} from "../harness";
import { HOLD_TICKS, HOLD_TOLERANCE_TICKS, readEveryBall } from "./harness";

/** Frames of the launched flight recorded after the hold runs out. */
const FLIGHT_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the balls for the specified hold at match start", async () => {
  await startWithKeys(h, "versus");

  const start = h.snapshot();
  assertEqual(start.screen, "countdown");
  for (const ball of readEveryBall(start)) assertEqual(ball.held, true);

  const launched = await captureReplay(h, "hold", async () => {
    const swept = await h.until((s) => s.screen === "playing", {
      maxFrames: 240,
      poll: 1,
    });
    await h.advance(FLIGHT_TICKS);
    return swept;
  });

  assertEqual(launched.hit, true);
  assertLessThanOrEqual(
    Math.abs(launched.frames - HOLD_TICKS),
    HOLD_TOLERANCE_TICKS,
  );
});
