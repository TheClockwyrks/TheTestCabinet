// spin/preserved-wall — spin survives a wall bounce.
//
// specs/balls.md: a wall bounce leaves speed and spin unchanged; the only
// things that change spin are paddle hits and the decay, which multiplies it by
// `0.5 ^ (elapsed / SPIN_HALFLIFE)` over any stretch of flight. A spinning ball
// is flown into the top wall, and its spin on the frame of the bounce is read
// against its posed spin decayed over exactly the frames flown. Two percent is
// rounding room: the product of the per-step factors is the same number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { FIELD_CX, SPIN_HALFLIFE } from "../constants";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

const SPIN = 600;
/** Straight up at the top wall from mid-field; the spin bends the rise a little. */
const BALL = { x: FIELD_CX, y: 200, vx: 0, vy: -400 };

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

it("keeps the spin, less the decay, through a wall bounce", async () => {
  await arrangeLiveBall(harness, BALL);
  await harness.debug.setBall(0, { spin: SPIN });
  const posed = ball0(await harness.snapshot()).spin;

  const bounce = await captureReplay(harness, "bounce", async () => {
    const rebound = await harness.until((s) => ball0(s).vy > 0, {
      maxFrames: 120,
      poll: 1,
    });
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  assertEqual(bounce.hit, true);
  const decayed =
    posed * Math.pow(0.5, bounce.frames / TICK_HZ / SPIN_HALFLIFE);
  assertLessThanOrEqual(
    Math.abs(ball0(bounce.snapshot).spin - decayed),
    SPIN_TOLERANCE * Math.abs(decayed),
  );
});
