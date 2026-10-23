// multi/ball-collision — two balls meeting exchange their velocities along the
// line joining their centers, and come apart.
//
// The cleanest case of that rule is the head-on one, and it is the one posed
// here: two balls level with each other on the mid-field lane, closing at the
// same speed. The line of centers is horizontal, so an elastic exchange between
// equal masses swaps the two horizontal velocities exactly — each ball leaves the
// way the other arrived, at the speed it arrived with, and neither gains any.
//
// The field holds THE PAIR AND NOTHING ELSE. The third ball is removed rather
// than parked in a corner, and so are both obstacles: the pair is what the rule
// is about, and nothing else on the field could then be what a reading of the
// exchange was really about. No paddle is taken either — the two balls are posed
// well inside the field and separate over a fraction of a second, so neither
// reaches an end of it, and a driven paddle would be one more thing this
// requirement does not concern.
//
// The real resolution is what produces the reading: nothing here writes a
// post-contact velocity, and the two balls are posed far enough apart that the
// approach is a real approach across an empty lane.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_COLLIDE_DIST, FIELD_CY } from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  enterPlaying,
  poseWorld,
  type Harness,
} from "../harness";
import { ballAt } from "./harness";

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
  enterPlaying(h);
  poseWorld(h, { balls: [0, 1] });
  h.multi.setBallPosition(0, LEFT_X, FIELD_CY);
  h.multi.setBallVelocity(0, APPROACH, 0);
  h.multi.setBallSpin(0, 0);
  h.multi.setBallPosition(1, RIGHT_X, FIELD_CY);
  h.multi.setBallVelocity(1, -APPROACH, 0);
  h.multi.setBallSpin(1, 0);

  const meeting = await captureReplay(h, "collision", async () => {
    const met = await h.until((s) => ballAt(s, 0).vx < 0, {
      maxFrames: 120,
      poll: 1,
    });
    await h.advance(DEPARTURE_TICKS);
    return met;
  });

  assertEqual(meeting.hit, true);
  // Read on the frame the pair came apart: the exchange is what is being graded,
  // and spin-free flight afterwards would only carry it further.
  const first = ballAt(meeting.snapshot, 0);
  const second = ballAt(meeting.snapshot, 1);

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
