// multi/relaunch-hold — a scored ball takes a full 1.0 s hold before it launches
// again.
//
// specs/balls.md: a ball that crosses a goal edge returns to its own home point
// and waits out a full HOLD_TIME there before it leaves again, on its own timer
// rather than the match's. So the count starts on the frame a REAL point lands,
// which is the moment the specification says that hold begins, and runs to the
// frame the build's own rule launches the ball.
//
// The point is driven over a field cleared back to the one ball it is about,
// with both obstacles off it and the paddles held clear of the lane, so nothing
// else can score while the hold is being counted and nothing can deflect the
// shot. The sweep steps ONE FRAME AT A TIME, so at the harness's 120 Hz clock
// the count is the duration; a coarser poll would report the hold as however far
// the sweep overshot it.
//
// THE OPENING HOLD is `gameplay/hold-length`'s point. The two are the same
// duration read at two moments, and a build that opens correctly and then
// relaunches instantly is a different fault from one that never holds at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createMultiHarness,
  startPlaying,
  type MultiHarness,
} from "../harness";
import {
  HOLD_TICKS,
  HOLD_TOLERANCE_TICKS,
  ballAt,
  driveLaunch,
} from "./harness";

/** Frames of the relaunched flight recorded after the hold runs out. */
const FLIGHT_TICKS = 60; // 0.5 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives a scored ball a hold of its own before it launches again", async () => {
  await startPlaying(h);
  await h.debug.setScore(0, 0);
  await arrangeGoal(h, "right");

  const scored = await h.until((s) => s.score.p1 > 0, {
    maxFrames: 360,
    poll: 1,
  });
  assertEqual(scored.hit, true);
  assertEqual(ballAt(scored.snapshot, 0).held, true);

  const relaunch = await captureReplay(h, "relaunch", async () => {
    const swept = await driveLaunch(h, 0);
    await h.advance(FLIGHT_TICKS);
    return swept;
  });

  assertEqual(relaunch.hit, true);
  assertLessThanOrEqual(
    Math.abs(relaunch.frames - HOLD_TICKS),
    HOLD_TOLERANCE_TICKS,
  );
});
