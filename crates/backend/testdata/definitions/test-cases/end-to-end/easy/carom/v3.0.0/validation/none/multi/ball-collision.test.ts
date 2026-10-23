// multi/ball-collision — two balls meeting exchange their velocities along the
// line joining their centers, and come apart.
//
// The cleanest case of that rule is the head-on one, and it is the one posed
// here: two balls level with each other on the mid-field lane, closing at the
// same speed. The line of centers is horizontal, so an elastic exchange between
// equal masses swaps the two horizontal velocities exactly — each ball leaves the
// way the other arrived, at the speed it arrived with, and neither gains any.
//
// THE FIELD HOLDS THOSE TWO BALLS AND NOTHING ELSE. The pair is what the rule is
// about: the third ball is off the field rather than tucked into a goal channel,
// and both obstacles come off with it, so the approach really is an empty lane
// and the only thing either ball can meet is the other one.
//
// The real resolution is what produces the reading: nothing here writes a
// post-contact velocity, and the two balls are posed far enough apart that the
// approach is a real approach.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { BALL_COLLIDE_DIST, FIELD_CY } from "../constants";
import {
  captureReplay,
  createMultiHarness,
  placeBall,
  startPlaying,
  type MultiHarness,
} from "../harness";
import { ballAt, isolateBalls } from "./harness";

/** The two balls the contact is between, in play order. */
const PAIR = [0, 1];

/** The closing speed each ball carries into the contact, in units per second. */
const APPROACH = 400;

/** Where the two balls are posed: level, either side of the field center. */
const LEFT_X = 520;
const RIGHT_X = 760;

/**
 * How far a velocity may miss the exchange: one percent of the approach speed.
 * The exchange is arithmetic on the two posed velocities, so this is rounding
 * room.
 */
const VELOCITY_TOLERANCE = APPROACH * 0.01;

/** Frames of the departure recorded after the contact. */
const DEPARTURE_TICKS = 45; // 0.375 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("exchanges the two velocities head-on and separates the pair", async () => {
  await startPlaying(h);
  await isolateBalls(h, PAIR);
  await placeBall(h, { x: LEFT_X, y: FIELD_CY, vx: APPROACH }, PAIR[0]);
  await placeBall(h, { x: RIGHT_X, y: FIELD_CY, vx: -APPROACH }, PAIR[1]);

  const meeting = await captureReplay(h, "collision", async () => {
    const met = await h.until((s) => ballAt(s, PAIR[0]).vx < 0, {
      maxFrames: 120,
      poll: 1,
    });
    // Read HERE, on the frame the pair came apart: the exchange is what is being
    // graded, and spin-free flight afterwards would only carry it further.
    const first = ballAt(met.snapshot, PAIR[0]);
    const second = ballAt(met.snapshot, PAIR[1]);
    await h.advance(DEPARTURE_TICKS);
    return { met, first, second };
  });

  assertEqual(meeting.met.hit, true);
  const { first, second } = meeting;

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
  // the line joining them.
  assertGreaterThanOrEqual(
    Math.hypot(first.x - second.x, first.y - second.y),
    BALL_COLLIDE_DIST - 1,
  );
});
