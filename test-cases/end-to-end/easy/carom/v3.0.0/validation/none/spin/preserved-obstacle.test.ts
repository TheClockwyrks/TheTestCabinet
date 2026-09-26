// spin/preserved-obstacle — spin survives an obstacle bounce.
//
// specs/playfield.md: an obstacle bounce leaves speed and spin unchanged; the
// only things that change spin are paddle hits and the decay, which multiplies
// it by `0.5 ^ (elapsed / SPIN_HALFLIFE)` over any stretch of flight
// (specs/balls.md). A spinning ball is flown at obstacle A's left face, and its
// spin on the frame of the bounce is read against its posed spin decayed over
// exactly the frames flown. Two percent is rounding room: the product of the
// per-step factors is the same number.
//
// The field is emptied and the struck obstacle alone is spawned back, so the
// bounce the spin is carried through is the only bounce there is. Under gyre
// the obstacles are held upright at clock 0.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import { OBSTACLES, OBSTACLE_CENTERS, SPIN_HALFLIFE } from "../constants";
import {
  arrangeFaceShot,
  ball0,
  ballOps,
  captureReplay,
  createHarness,
  driveFaceBounce,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Obstacle A: the one body the field is left holding beside the ball. */
const OBSTACLE = 0;
const RECT = OBSTACLES[OBSTACLE];

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
  await arrangeFaceShot(harness, OBSTACLE, "left");
  await (await ballOps(harness)).setSpin(SPIN);
  await harness.debug.reconcile();
  const posed = ball0(await harness.snapshot()).spin;

  const bounce = await captureReplay(harness, "bounce", async () => {
    const rebound = await driveFaceBounce(harness, "left");
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  assertEqual(bounce.hit, true);
  const struck = ball0(bounce.snapshot);
  // It met the face it was aimed at, rather than an end of the obstacle.
  assertGreaterThan(struck.y, RECT.y0);
  assertLessThan(struck.y, RECT.y1);
  assertLessThan(struck.x, OBSTACLE_CENTERS[OBSTACLE].x);
  const decayed =
    posed * Math.pow(0.5, bounce.frames / TICK_HZ / SPIN_HALFLIFE);
  assertLessThanOrEqual(
    Math.abs(struck.spin - decayed),
    SPIN_TOLERANCE * Math.abs(decayed),
  );
});
