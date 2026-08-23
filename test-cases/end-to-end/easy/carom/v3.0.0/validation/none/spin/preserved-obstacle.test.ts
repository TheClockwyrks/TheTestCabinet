// spin/preserved-obstacle — spin survives an obstacle bounce.
//
// specs/playfield.md: an obstacle bounce leaves speed and spin unchanged; the
// only things that change spin are paddle hits and the decay, which multiplies
// it by `0.5 ^ (elapsed / SPIN_HALFLIFE)` over any stretch of flight
// (specs/balls.md). A spinning ball is flown at obstacle A's left face, and its
// spin on the frame of the bounce is read against its posed spin decayed over
// exactly the frames flown. Two percent is rounding room: the product of the
// per-step factors is the same number. Under gyre the obstacles are held
// upright at clock 0.

import { afterEach, beforeEach, expect, it } from "vitest";
import { OBSTACLES, OBSTACLE_CENTERS, SPIN_HALFLIFE } from "../constants";
import {
  arrangeFaceShot,
  ball0,
  captureReplay,
  createHarness,
  driveFaceBounce,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Gentle enough that the curve keeps the ball on the face it is aimed at. */
const SPIN = 300;
const SPIN_TOLERANCE = 0.02;

/** Frames of the departing flight recorded after the bounce, for the replay. */
const DEPARTURE_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("keeps the spin, less the decay, through an obstacle bounce", async () => {
  await startPlaying(harness);
  await arrangeFaceShot(harness, OBSTACLES[0], "left");
  await harness.debug.setBall(0, { spin: SPIN });
  const posed = ball0(await harness.snapshot()).spin;

  const bounce = await captureReplay(harness, "bounce", async () => {
    const rebound = await driveFaceBounce(harness, "left");
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  expect(bounce.hit).toBe(true);
  const struck = ball0(bounce.snapshot);
  // It met the face it was aimed at, rather than an end of the obstacle.
  expect(struck.y).toBeGreaterThan(OBSTACLES[0].y0);
  expect(struck.y).toBeLessThan(OBSTACLES[0].y1);
  expect(struck.x).toBeLessThan(OBSTACLE_CENTERS[0].x);
  const decayed =
    posed * Math.pow(0.5, bounce.frames / TICK_HZ / SPIN_HALFLIFE);
  expect(Math.abs(struck.spin - decayed)).toBeLessThanOrEqual(
    SPIN_TOLERANCE * Math.abs(decayed),
  );
});
