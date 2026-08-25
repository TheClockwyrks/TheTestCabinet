// multi/ball-collision — two balls meeting exchange their velocities along the
// line joining their centers, and come apart.
//
// The cleanest case of that rule is the head-on one, and it is the one posed
// here: two balls level with each other on the mid-field lane, closing at the
// same speed. The line of centers is horizontal, so an elastic exchange between
// equal masses swaps the two horizontal velocities exactly — each ball leaves the
// way the other arrived, at the speed it arrived with, and neither gains any.
// The third ball is parked in the goal channel and takes no part.
//
// The real resolution is what produces that: nothing here writes a post-contact
// velocity, and the two balls are posed far enough apart that the approach is a
// real approach across an empty lane.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_COLLIDE_DIST, FIELD_CY } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureReplay,
  clearPaddles,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { readBalls } from "./harness";

/** The closing speed each ball carries into the contact, in units per second. */
const APPROACH = 400;

/** Where the two balls are posed: level, either side of the field center. */
const LEFT_X = 520;
const RIGHT_X = 760;

/** The review item's margin: one percent of the speed each ball arrives at. */
const VELOCITY_TOLERANCE = APPROACH * 0.01;

/** Frames of the departure recorded after the contact. */
const DEPARTURE_TICKS = 45; // 0.375 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("exchanges the two velocities head-on and separates the pair", async () => {
  await startPlaying(h);
  clearPaddles(h);
  h.debug.setBall(0, {
    x: LEFT_X,
    y: FIELD_CY,
    vx: APPROACH,
    vy: 0,
    spin: 0,
  });
  h.debug.setBall(1, {
    x: RIGHT_X,
    y: FIELD_CY,
    vx: -APPROACH,
    vy: 0,
    spin: 0,
  });

  const meeting = await captureReplay(h, "collision", async () => {
    const met = await h.until((s) => readBalls(s)[0].vx < 0, {
      maxFrames: 120,
      poll: 1,
    });
    // Read HERE, on the frame the pair came apart: the exchange is what is being
    // graded, and spin-free flight afterwards would only carry it further.
    const balls = readBalls(met.snapshot);
    await h.advance(DEPARTURE_TICKS);
    return { met, balls };
  });

  assertEqual(meeting.met.hit, true);
  const [first, second] = meeting.balls;

  // Each leaves the way the other arrived.
  assertLessThanOrEqual(Math.abs(first.vx + APPROACH), VELOCITY_TOLERANCE);
  assertLessThanOrEqual(Math.abs(second.vx - APPROACH), VELOCITY_TOLERANCE);
  // The line of centers is horizontal, so the across-the-line components — both
  // zero here — are left as they are.
  assertLessThanOrEqual(Math.abs(first.vy), VELOCITY_TOLERANCE);
  assertLessThanOrEqual(Math.abs(second.vy), VELOCITY_TOLERANCE);
  // The velocities were redistributed, not added to: a paddle hit is the only
  // collision in this game that changes a ball's speed.
  assertLessThanOrEqual(first.speed, APPROACH + VELOCITY_TOLERANCE);
  assertLessThanOrEqual(second.speed, APPROACH + VELOCITY_TOLERANCE);

  // And they are apart rather than overlapping: the pair is pushed clear along
  // the line joining them "until they no longer overlap" (specs/balls.md), so
  // the centers are at least BALL_COLLIDE_DIST apart to a float margin.
  assertGreaterThanOrEqual(
    Math.hypot(first.x - second.x, first.y - second.y),
    BALL_COLLIDE_DIST - 1e-6,
  );
});
