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

import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_COLLIDE_DIST, FIELD_CY } from "../../src/constants";
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

/** How far a velocity may miss the exchange, in units per second. */
const VELOCITY_TOLERANCE = 12;

/** Frames of the departure recorded after the contact. */
const DEPARTURE_TICKS = 45; // 0.375 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
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

  expect(meeting.met.hit).toBe(true);
  const [first, second] = meeting.balls;

  // Each leaves the way the other arrived.
  expect(Math.abs(first.vx + APPROACH)).toBeLessThanOrEqual(VELOCITY_TOLERANCE);
  expect(Math.abs(second.vx - APPROACH)).toBeLessThanOrEqual(
    VELOCITY_TOLERANCE,
  );
  // The line of centers is horizontal, so the across-the-line components — both
  // zero here — are left as they are.
  expect(Math.abs(first.vy)).toBeLessThanOrEqual(VELOCITY_TOLERANCE);
  expect(Math.abs(second.vy)).toBeLessThanOrEqual(VELOCITY_TOLERANCE);
  // The velocities were redistributed, not added to: a paddle hit is the only
  // collision in this game that changes a ball's speed.
  expect(first.speed).toBeLessThanOrEqual(APPROACH + VELOCITY_TOLERANCE);
  expect(second.speed).toBeLessThanOrEqual(APPROACH + VELOCITY_TOLERANCE);

  // And they are apart rather than overlapping: the pair is pushed clear along
  // the line joining them.
  expect(
    Math.hypot(first.x - second.x, first.y - second.y),
  ).toBeGreaterThanOrEqual(BALL_COLLIDE_DIST - 1);
});
