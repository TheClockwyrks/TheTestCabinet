// multi/launch-angle-drawn — parking draws the launch angle afresh, uniformly
// over the full circle.
//
// One reading cannot show a draw: any one launch has some angle. So a small
// sample is taken through `drawBallLaunchAngle`, the operation that performs the
// one draw parking makes and nothing else (specs/instrumentation.md), and the
// angle is read straight back off the snapshot each time. Every reading is held
// to the draw's range, `[0, 2 * PI)`, and the sample as a whole to the one thing
// a draw over the circle shows and an aimed launch cannot: the readings differ.
// How the angles spread around the circle is the reviewer's to judge from the
// replay rather than this check's to count.
//
// The sample is small, and the bar is one a continuous draw cannot miss: sixteen
// draws over a continuum land on one value only when a build fixes its launch.
// Three balls leaving on their last drawn angles are recorded for the reviewer.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
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
const DRAWS = 16;

/** Frames of the hold recorded before it is cut short. */
const HELD_TICKS = 24; // 0.2 s
/** Frames of the launched flight recorded after the launch. */
const FLIGHT_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the launch angle afresh over the circle, and the draws differ", async () => {
  await openCountdown(h, "versus");
  isolateField(h, { balls: BALL_COUNT });

  const angles = new Set<number>();
  for (let i = 0; i < DRAWS; i += 1) {
    multiOps(h).drawBallLaunchAngle(0);
    const angle = ballAt(h.snapshot(), 0).launchAngle as number;
    assertGreaterThanOrEqual(angle, 0);
    assertLessThan(angle, 2 * Math.PI);
    angles.add(angle);
  }
  assertGreaterThan(angles.size, 1);

  // The three balls leaving on their last drawn angles, kept for the reviewer.
  const launched = await captureReplay(h, "launch", async () => {
    await h.advance(HELD_TICKS);
    const swept = await reachPlay(h, { maxFrames: 20 });
    await h.advance(FLIGHT_TICKS);
    return swept;
  });
  assertEqual(launched.hit, true);
});
