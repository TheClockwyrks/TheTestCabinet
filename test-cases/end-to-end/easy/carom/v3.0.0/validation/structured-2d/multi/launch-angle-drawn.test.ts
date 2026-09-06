// multi/launch-angle-drawn — parking draws the launch angle afresh, uniformly
// over the full circle.
//
// One reading cannot show a draw: any one launch has some angle. So the draw is
// sampled through `drawBallLaunchAngle`, the operation that performs the one
// draw parking makes and nothing else (specs/instrumentation.md), and the angle
// is read straight back off the snapshot each time. Every reading is held to the
// draw's range, `[0, 2 * PI)`, and the sample as a whole to what a uniform draw
// over the whole circle gives and an aimed launch cannot: most of it is nowhere
// near horizontal, and it heads both ways across the field.
//
// The bounds are generous against a uniform draw and unreachable by a build that
// aims its launches. A uniform draw puts two thirds of its angles outside a
// +/-30 degree band about horizontal, 48 of the 72 here, and the bar is 24: six
// standard deviations below that mean. One angle each way is what "both
// directions" means, and a uniform draw misses that one time in 2^71. Three
// balls leaving on their last drawn angles are recorded for the reviewer.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { BALL_COUNT } from "../constants";
import {
  captureReplay,
  createHarness,
  isolateField,
  openCountdown,
  reachPlay,
  type Harness,
} from "../harness";
import { ballAt, multiOps } from "./harness";

/** How many draws the sample takes, all on ball `0`. */
const DRAWS = 72;

/**
 * The band the steep draws are counted outside of, in degrees from horizontal,
 * and how many of the sample must fall outside it: six standard deviations
 * below the two thirds a uniform draw over the circle puts there.
 */
const FLAT_DEG = 30;
const STEEP_MIN = 24;

/** How many draws must head each way across the field. */
const EACH_WAY_MIN = 1;

/** Frames of the hold recorded before it is cut short. */
const HELD_TICKS = 24; // 0.2 s
/** Frames of the launched flight recorded after the launch. */
const FLIGHT_TICKS = 90; // 0.75 s

/** Whether an angle, in radians, is steeper than `FLAT_DEG` from horizontal. */
function isSteep(angle: number): boolean {
  return Math.abs(Math.sin(angle)) > Math.sin((FLAT_DEG * Math.PI) / 180);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the launch angle afresh, uniformly over the whole circle", async () => {
  await openCountdown(h, "versus");
  isolateField(h, { balls: BALL_COUNT });

  const angles: number[] = [];
  for (let i = 0; i < DRAWS; i += 1) {
    multiOps(h).drawBallLaunchAngle(0);
    const angle = ballAt(h.snapshot(), 0).launchAngle as number;
    assertGreaterThanOrEqual(angle, 0);
    assertLessThan(angle, 2 * Math.PI);
    angles.push(angle);
  }
  assertGreaterThanOrEqual(angles.filter(isSteep).length, STEEP_MIN);
  assertGreaterThanOrEqual(
    angles.filter((angle) => Math.cos(angle) > 0).length,
    EACH_WAY_MIN,
  );
  assertGreaterThanOrEqual(
    angles.filter((angle) => Math.cos(angle) < 0).length,
    EACH_WAY_MIN,
  );

  // The three balls leaving on their last drawn angles, kept for the reviewer.
  const launched = await captureReplay(h, "launch", async () => {
    await h.advance(HELD_TICKS);
    const swept = await reachPlay(h, { maxFrames: 20 });
    await h.advance(FLIGHT_TICKS);
    return swept;
  });
  assertEqual(launched.hit, true);
});
