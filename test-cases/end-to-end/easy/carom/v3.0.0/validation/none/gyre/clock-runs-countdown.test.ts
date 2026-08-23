// gyre/clock-runs-countdown — the obstacle clock advances during the pre-serve
// countdown.
//
// specs/playfield.md: the obstacle clock advances by the frame's delta time on
// every frame of a live match, the countdown included, and
// `theta(t) = OBSTACLE_SPIN_RATE * t`. A match is started from the title with
// the menu keys alone, so no control operation holds the clock, and both
// obstacles' rotations are read at two countdown frames a known number of
// frames apart. The turn between them is the rate times that span, within the
// same 0.01 radians `obstacles-spin` allows.

import { afterEach, beforeEach, expect, it } from "vitest";
import { OBSTACLE_SPIN_RATE } from "../constants";
import {
  captureReplay,
  createHarness,
  seconds,
  startWithKeys,
  type Harness,
} from "../harness";
import { angleDelta, readObstacles } from "./harness";

/** Frames advanced between the two readings, well inside the hold. */
const SPAN_TICKS = 30; // 0.25 s of a 1 s countdown

/** The review item's margin, in radians. */
const ANGLE_TOLERANCE = 0.01;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("turns the obstacles while the countdown runs", async () => {
  await startWithKeys(harness, "versus");
  expect((await harness.snapshot()).screen).toBe("countdown");
  const opening = await readObstacles(harness);

  await captureReplay(harness, "countdown", async () => {
    await harness.advance(SPAN_TICKS);
  });

  expect((await harness.snapshot()).screen).toBe("countdown");
  const later = await readObstacles(harness);
  const expectedTurn = OBSTACLE_SPIN_RATE * seconds(SPAN_TICKS);
  for (const [i, before] of opening.entries()) {
    const after = later[i]!;
    expect(
      Math.abs(angleDelta(after.theta, before.theta + expectedTurn)),
      `obstacle ${i} turned OBSTACLE_SPIN_RATE * elapsed during the countdown`,
    ).toBeLessThanOrEqual(ANGLE_TOLERANCE);
  }
});
