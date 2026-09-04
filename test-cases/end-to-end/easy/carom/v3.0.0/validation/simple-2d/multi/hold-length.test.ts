// multi/hold-length — a hold lasts the specified 1.0 s, at match start and again
// after a ball is scored.
//
// The opening is measured FROM THE TITLE with menu keys, on the field the build's
// own match start builds: what is graded is the duration that start sets running,
// so a check that posed the balls back onto the field would have set those holds
// itself and read its own arrangement.
//
// The respawn is measured from the frame a real point lands, which is the moment
// the specification says the scored ball takes a full hold — and that half of the
// point IS about one ball, so its field is emptied down to the one ball driven
// through the goal, with both obstacles gone and the paddles driven out of the
// lane. Both halves are stepped ONE FRAME AT A TIME, so at the harness's 120 Hz
// clock the count is the duration.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  enterPlaying,
  startWithKeys,
  type Harness,
} from "../harness";
import {
  HOLD_TICKS,
  HOLD_TOLERANCE_TICKS,
  ballAt,
  driveLaunch,
  readBalls,
} from "./harness";

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

it("gives a scored ball a hold of its own before it launches again", async () => {
  enterPlaying(h);
  arrangeGoal(h, "right");

  const scored = await h.until((s) => s.score.p1 > 0, {
    maxFrames: 360,
    poll: 1,
  });
  assertEqual(scored.hit, true);
  assertEqual(ballAt(scored.snapshot, 0).held, true);

  const relaunch = await driveLaunch(h, 0);
  assertEqual(relaunch.hit, true);
  assertLessThanOrEqual(
    Math.abs(relaunch.frames - HOLD_TICKS),
    HOLD_TOLERANCE_TICKS,
  );
});
