// multi/hold-length — a hold lasts the specified 1.0 s, at match start and again
// after a ball is scored.
//
// The opening is measured FROM THE TITLE with menu keys, and nothing is posed or
// removed on the way: the world the check counts through is the one the build's
// own match start made, because every operation that would tidy it — spawning a
// ball, clearing the field — restarts the very timer being measured. The
// obstacles stay for the same reason, and a waiting ball touches neither.
//
// The respawn is measured from the frame a real point lands, over a field
// isolated to the one ball that scores it, which is the moment the specification
// says that ball takes a full hold. Both are stepped ONE FRAME AT A TIME, so at
// the harness's 120 Hz clock the count is the duration.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  startWithKeys,
  type Harness,
} from "../harness";
import {
  HOLD_TICKS,
  HOLD_TOLERANCE_TICKS,
  ballAt,
  driveLaunch,
  readEveryBall,
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

it("gives a scored ball a hold of its own before it launches again", async () => {
  await arrangeGoal(h, "right");
  h.debug.setScore(0, 0);

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
