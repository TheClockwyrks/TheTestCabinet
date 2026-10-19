// multi/hold-length — the opening hold lasts the specified 1.0 s.
//
// The opening is measured FROM THE TITLE with menu keys, on the field the build's
// own match start builds: what is graded is the duration that start sets running,
// so a check that posed the balls back onto the field would have set those holds
// itself and read its own arrangement. The hold is stepped ONE FRAME AT A TIME,
// so at the harness's 120 Hz clock the count is the duration.
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
import { HOLD_TICKS, HOLD_TOLERANCE_TICKS, readBalls } from "./harness";

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
  for (const ball of readBalls(start)) assertEqual(ball.held, true);

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
