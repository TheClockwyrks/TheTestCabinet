// gyre/clock-runs-countdown — the obstacle clock advances during the pre-serve
// countdown.
//
// specs/playfield.md: the obstacle clock advances by the frame's delta time on
// every frame of a live match, the countdown included, and
// `theta(t) = OBSTACLE_SPIN_RATE * t`. A match is started from the title with
// the menu keys alone, so no operation of the surface poses or holds the clock,
// and both obstacles' rotations are read at two countdown frames a known number
// of frames apart. The turn between them is the rate times that span, within the
// same 0.01 radians `obstacles-spin` allows.
//
// The field is the one the build's own match start built, and deliberately so.
// The countdown is the screen under test, and what keeps the game on it is the
// held ball counting its hold down (specs/balls.md); emptying the field would end
// the countdown on the first frame and leave nothing to measure. So the ball here
// is part of the scenario rather than a bystander, and nothing is posed to keep it
// quiet — it waits at its home, as a countdown's ball does.

import { afterEach, beforeEach, it } from "vitest";
import { OBSTACLE_SPIN_RATE } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  seconds,
  startWithKeys,
  type Harness,
} from "../harness";
import { angleDelta, obstaclePose, readObstacles, thetaOf } from "./harness";

/** Frames advanced between the two readings, well inside the hold. */
const SPAN_TICKS = 30; // 0.25 s of a 1 s countdown

/** The review item's margin, in radians. */
const ANGLE_TOLERANCE = 0.01;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("turns the obstacles while the countdown runs", async () => {
  await startWithKeys(harness, "versus");
  assertEqual(harness.snapshot().screen, "countdown");
  const opening = readObstacles(harness);

  await captureReplay(harness, "countdown", async () => {
    await harness.advance(SPAN_TICKS);
  });

  assertEqual(harness.snapshot().screen, "countdown");
  const later = readObstacles(harness);
  const expectedTurn = OBSTACLE_SPIN_RATE * seconds(SPAN_TICKS);
  for (const before of opening) {
    const after = obstaclePose(later, before.index);
    assertLessThanOrEqual(
      Math.abs(angleDelta(thetaOf(after), thetaOf(before) + expectedTurn)),
      ANGLE_TOLERANCE,
      `obstacle ${before.index} turned OBSTACLE_SPIN_RATE * elapsed during the countdown`,
    );
  }
});
