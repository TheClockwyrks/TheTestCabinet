// spin/curve-negative — negative spin turns the heading counterclockwise on screen.
//
// specs/balls.md: every sub-step the velocity is rotated by `(spin / speed) * h`
// radians, a positive angle turning the direction of travel from `+x` toward
// `+y`, clockwise on screen, with the speed unchanged; then the spin decays by
// `0.5 ^ (h / SPIN_HALFLIFE)`. A ball posed level with `vx > 0` and negative
// spin therefore has, after a short flight, `vy < 0` and the same speed.
//
// The heading is read against the arc the rule integrates to: with the spin
// decaying exponentially, the total turn over `t` is
// `(spin0 / speed) * (SPIN_HALFLIFE / ln 2) * (1 - 0.5 ^ (t / SPIN_HALFLIFE))`.
// The sub-step rule applies the spin of the start of each step, which over the
// 0.2 s flown here differs from that integral by under a tenth of a degree; two
// degrees is the room allowed. One percent on the speed is rounding room, since
// the rotation preserves it exactly.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY, SPIN_HALFLIFE } from "../constants";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

const SPIN = -600;
/** A level flight across the open left half of the field. */
const BALL = { x: 200, y: FIELD_CY, vx: 400, vy: 0 };

const FLIGHT_TICKS = 24; // 0.2 s
const FLIGHT_S = FLIGHT_TICKS / TICK_HZ;

/** The turn the rule integrates to over the flight, in radians. */
const EXPECTED_TURN =
  (SPIN / BALL.vx) *
  (SPIN_HALFLIFE / Math.LN2) *
  (1 - Math.pow(0.5, FLIGHT_S / SPIN_HALFLIFE));

const TURN_TOLERANCE = (2 * Math.PI) / 180;
const SPEED_TOLERANCE = 0.01;

/** Frames of the flight recorded after the read, for the replay. */
const DEPARTURE_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("turns a level flight counterclockwise on screen under negative spin, keeping its speed", async () => {
  await arrangeLiveBall(harness, BALL);
  await harness.debug.setBall(0, { spin: SPIN });
  const posed = ball0(await harness.snapshot());

  const flown = await captureReplay(harness, "curve", async () => {
    await harness.advance(FLIGHT_TICKS);
    const read = ball0(await harness.snapshot());
    await harness.advance(DEPARTURE_TICKS);
    return read;
  });

  expect(flown.vy).toBeLessThan(0);
  expect(Math.abs(flown.speed - posed.speed)).toBeLessThanOrEqual(
    SPEED_TOLERANCE * posed.speed,
  );
  const turned =
    Math.atan2(flown.vy, flown.vx) - Math.atan2(posed.vy, posed.vx);
  expect(Math.abs(turned - EXPECTED_TURN)).toBeLessThanOrEqual(TURN_TOLERANCE);
});
