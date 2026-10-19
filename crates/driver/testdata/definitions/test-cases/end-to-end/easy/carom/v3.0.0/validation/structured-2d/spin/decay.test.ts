// spin/decay — spin decays by half every SPIN_HALFLIFE.
//
// A ball in flight is posed with spin, then the real simulation is stepped
// forward and the spin the build reports is what decays. Every sub-step applies
// `spin *= 0.5 ^ (h / SPIN_HALFLIFE)` (specs/balls.md), so over any interval the
// factor is `0.5 ^ (elapsed / SPIN_HALFLIFE)` however the frames were cut: half
// after one half-life, and `0.5 ^ 2.5`, under a fifth, after two seconds.
//
// The decay is measured on a ball IN FLIGHT, the only state real play ever has.
// To read the decaying spin without the strongly curving shot leaving the field,
// the ball's POSITION is re-centred between chunks while its velocity and spin
// carry through untouched; only the elapsed simulation time acts on the spin.
// The field holds that one ball and neither obstacle, and both paddles are held
// off the lane, so nothing the ball curves into can change the spin either.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CX, FIELD_CY, SPIN_HALFLIFE } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  arrangeLiveBall,
  ball0,
  ballOps,
  captureReplay,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The spin posed on the ball, in units per second squared. */
const POSED_SPIN = 600;
/** One half-life, and the further flight that takes the total to two seconds. */
const HALF_LIFE_TICKS = Math.round(SPIN_HALFLIFE * TICK_HZ);
const TOTAL_TICKS = 2 * TICK_HZ;
/** How often the curving ball is put back at the centre, in frames. */
const RECENTER_CHUNK = 12;

/** The review item's margins: five percent about one half, and under a fifth. */
const HALF_LIFE_TOLERANCE = 0.5 * 0.05;
const SETTLED_MAX = 0.2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

/**
 * Fly the ball for `ticks` frames, putting it back at the field centre every
 * chunk so the curve cannot carry it off the field. Velocity and spin are left
 * alone, so only the elapsed time acts on the spin.
 */
async function flyFor(h: Harness, ticks: number): Promise<void> {
  const ops = ballOps(h);
  for (let done = 0; done < ticks; done += RECENTER_CHUNK) {
    await h.advance(Math.min(RECENTER_CHUNK, ticks - done));
    ops.setBallPosition(FIELD_CX, FIELD_CY);
  }
}

it("halves the spin every half-life without changing its sign", async () => {
  await arrangeLiveBall(harness, { x: FIELD_CX, y: FIELD_CY, vx: 400 });
  ballOps(harness).setBallSpin(POSED_SPIN);
  assertCloseTo(ball0(harness.snapshot()).spin, POSED_SPIN, 6);

  await captureReplay(harness, "decay", async () => {
    await flyFor(harness, HALF_LIFE_TICKS);
    const afterOne = ball0(harness.snapshot()).spin;

    assertEqual(Math.sign(afterOne), Math.sign(POSED_SPIN));
    assertLessThanOrEqual(
      Math.abs(afterOne / POSED_SPIN - 0.5),
      HALF_LIFE_TOLERANCE,
    );

    await flyFor(harness, TOTAL_TICKS - HALF_LIFE_TICKS);
    const settled = ball0(harness.snapshot()).spin;

    assertEqual(Math.sign(settled), Math.sign(POSED_SPIN));
    assertLessThan(Math.abs(settled), SETTLED_MAX * POSED_SPIN);
  });
});
