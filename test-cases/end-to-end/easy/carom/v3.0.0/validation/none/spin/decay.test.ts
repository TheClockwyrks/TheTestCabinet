// spin/decay — spin decays by half every SPIN_HALFLIFE.
//
// specs/balls.md: every sub-step, `spin *= 0.5 ^ (h / SPIN_HALFLIFE)`, so over
// any stretch of flight the spin is multiplied by `0.5 ^ (elapsed /
// SPIN_HALFLIFE)` however the stretch was divided. A ball is posed in flight
// with a known spin and flown for one half-life: the magnitude is half, within
// five percent, with the sign kept. Flown on to two seconds in all, it is
// `0.5 ^ 2.5` of the start, under a fifth.
//
// The decay is measured on a ball IN FLIGHT, the only state real play has. So
// the strongly curving shot does not leave the field or meet anything, the
// paddles are cleared and the ball's POSITION is re-centered between chunks
// while its velocity and spin carry through untouched: only elapsed time acts
// on the spin.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CX, FIELD_CY, SPIN_HALFLIFE } from "../constants";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The posed spin, a brisk swing's worth, and a level mid-field flight. */
const SPIN = 600;
const BALL = { x: FIELD_CX, y: FIELD_CY, vx: 400, vy: 0 };

/** One half-life, and the further flight that takes the total to 2 s. */
const HALF_LIFE_TICKS = Math.round(SPIN_HALFLIFE * TICK_HZ);
const TOTAL_TICKS = 2 * TICK_HZ;
/** How often the curving ball is put back at the center, in frames. */
const RECENTER_CHUNK = 12;

const HALF_TOLERANCE = 0.05;
const SETTLED_MAX = 0.2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/**
 * Fly the ball for `ticks` frames, putting it back at the field center every
 * chunk so the curve cannot carry it off the field. Velocity and spin are left
 * alone, so only the elapsed time acts on the spin.
 */
async function flyFor(h: Harness, ticks: number): Promise<void> {
  for (let done = 0; done < ticks; done += RECENTER_CHUNK) {
    await h.advance(Math.min(RECENTER_CHUNK, ticks - done));
    await h.debug.setBall(0, { x: FIELD_CX, y: FIELD_CY });
  }
}

it("halves the spin every half-life without changing its sign", async () => {
  await arrangeLiveBall(harness, BALL);
  await harness.debug.setBall(0, { spin: SPIN });
  const posed = ball0(await harness.snapshot()).spin;
  expect(posed).toBeCloseTo(SPIN, 6);

  await captureReplay(harness, "decay", async () => {
    await flyFor(harness, HALF_LIFE_TICKS);
    const afterOne = ball0(await harness.snapshot()).spin;

    expect(Math.sign(afterOne)).toBe(Math.sign(posed));
    expect(Math.abs(Math.abs(afterOne) - 0.5 * SPIN)).toBeLessThanOrEqual(
      HALF_TOLERANCE * 0.5 * SPIN,
    );

    await flyFor(harness, TOTAL_TICKS - HALF_LIFE_TICKS);
    const settled = ball0(await harness.snapshot()).spin;

    expect(Math.sign(settled)).toBe(Math.sign(posed));
    expect(Math.abs(settled)).toBeLessThan(SETTLED_MAX * SPIN);
  });
});
