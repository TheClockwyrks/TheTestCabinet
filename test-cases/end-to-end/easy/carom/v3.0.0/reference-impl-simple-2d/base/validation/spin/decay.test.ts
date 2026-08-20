// spin/decay — imparted spin decays after the hit, so a curved shot straightens.
//
// Spin is imparted by a REAL moving-paddle contact, then the real simulation is
// stepped forward and the spin the build reports is what decays: it loses half
// its magnitude every half-life, without changing sign.
//
// The decay is measured on a ball IN FLIGHT, the only state real play ever has —
// never a parked, zero-velocity ball, which no rally would reach. To read the
// decaying spin without the strongly curving shot leaving the field, the paddles
// are cleared (so no further hit changes spin) and the ball's POSITION is
// re-centred between chunks while its velocity and spin carry through untouched.
// The spin therefore decays purely from the elapsed simulation time.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  FIELD_CX,
  FIELD_CY,
  PADDLE_SPEED,
  SPIN_FROM_PADDLE,
  SPIN_HALFLIFE,
} from "../../src/constants";
import {
  TICK_HZ,
  arrangePaddleHit,
  clearPaddles,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

/** One half-life, and the further flight that takes the total to ~2.5 half-lives. */
const HALF_LIFE_TICKS = Math.round(SPIN_HALFLIFE * TICK_HZ);
const FURTHER_TICKS = Math.round(SPIN_HALFLIFE * TICK_HZ * 1.5);
/** How often the curving ball is put back at the centre, in frames. */
const RECENTER_CHUNK = 12;

const SPIN_FLOOR = PADDLE_SPEED * SPIN_FROM_PADDLE * 0.65;
/** After one half-life the magnitude sits at half, with room for a frame either side. */
const HALF_LIFE_MIN = 0.4;
const HALF_LIFE_MAX = 0.6;
/** After ~2.5 half-lives it is a small fraction of where it started. */
const SETTLED_MAX = 0.25;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

/**
 * Fly the ball for `ticks` frames, putting it back at the field centre every
 * chunk so the curve cannot carry it off the field. Velocity and spin are left
 * alone, so only the elapsed time acts on the spin.
 */
async function flyFor(h: Harness, ticks: number): Promise<void> {
  for (let done = 0; done < ticks; done += RECENTER_CHUNK) {
    await h.advance(Math.min(RECENTER_CHUNK, ticks - done));
    h.debug.setBall(0, { x: FIELD_CX, y: FIELD_CY });
  }
}

it("halves the spin every half-life without changing its sign", async () => {
  await startPlaying(harness);
  arrangePaddleHit(harness, "left", {
    cy: FIELD_CY - 20,
    vy: PADDLE_SPEED,
    ballY: FIELD_CY,
  });

  const contact = await drivePaddleHit(harness, "left");
  const imparted = contact.ball.spin;

  expect(contact.hit).toBe(true);
  expect(imparted).toBeGreaterThan(SPIN_FLOOR);

  // No paddle may touch the ball again, or a second hit would change the spin
  // this check is watching decay.
  clearPaddles(harness);

  await flyFor(harness, HALF_LIFE_TICKS);
  const afterOne = harness.snapshot().ball.spin;

  expect(Math.sign(afterOne)).toBe(Math.sign(imparted));
  expect(Math.abs(afterOne)).toBeGreaterThan(
    HALF_LIFE_MIN * Math.abs(imparted),
  );
  expect(Math.abs(afterOne)).toBeLessThan(HALF_LIFE_MAX * Math.abs(imparted));

  await flyFor(harness, FURTHER_TICKS);
  const settled = harness.snapshot().ball.spin;

  expect(Math.abs(settled)).toBeLessThan(SETTLED_MAX * Math.abs(imparted));
});
