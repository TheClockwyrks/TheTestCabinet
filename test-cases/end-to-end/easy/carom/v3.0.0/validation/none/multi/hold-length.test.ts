// multi/hold-length — the opening hold lasts the specified 1.0 s.
//
// The opening is measured FROM THE TITLE with menu keys, and the world it opens
// on is left exactly as the build's own match start built it. Nothing is cleared
// and nothing is spawned: `spawnBall` gives a ball a full timer, so a field posed
// after the match opened would restart the very hold being measured and the count
// would be of the pose rather than of the build's match start. The hold is
// stepped ONE FRAME AT A TIME, so at the harness's 120 Hz clock the count is the
// duration.
//
// THE HOLD A SCORED BALL TAKES is `gameplay/relaunch-hold`'s point. The two are
// the same duration read at two moments, and a build that opens correctly and
// then relaunches instantly is a different fault from one that never holds at
// all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThanOrEqual } from "../assert";
import { BALL_COUNT } from "../constants";
import {
  captureReplay,
  createMultiHarness,
  startWithKeys,
  type MultiHarness,
} from "../harness";
import { HOLD_TICKS, HOLD_TOLERANCE_TICKS, readBalls } from "./harness";

/** Frames of the launched flight recorded after the hold runs out. */
const FLIGHT_TICKS = 60; // 0.5 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the balls for the specified hold at match start", async () => {
  await startWithKeys(h, "versus");

  const start = await h.snapshot();
  assertEqual(start.screen, "countdown");
  const opening = readBalls(start);
  assertLength(opening, BALL_COUNT);
  for (const ball of opening) assertEqual(ball.held, true);

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
