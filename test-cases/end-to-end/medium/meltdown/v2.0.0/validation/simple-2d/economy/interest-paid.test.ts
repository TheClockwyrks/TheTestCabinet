// economy/interest-paid — entering a build phase between waves pays 8% of the
// money on hand.
//
// specs/economy.md's income table: the Interest line pays
// `min(floor(INTEREST_RATE * money), INTEREST_CAP)`, "which is
// `floor(0.08 * money)` capped at `40`", "On entering a build phase between
// waves". specs/waves.md fixes how that phase is entered: a wave clears, "the wave
// number rises by one and a build phase for the next wave begins, with its timer
// at `BUILD_PHASE_TIME` and its interest paid". So the transition is reached the
// way the run reaches it — a wave cleared — because `setPhase` "runs no entry
// effect" and "pays interest" is exactly the effect under test
// (specs/instrumentation.md).
//
// WHY THIS POINT READS A SLOPE RATHER THAN A TOTAL. The transition that pays the
// interest also pays the wave-clear bonus, and it pays it FIRST, so the balance
// after a clear is two figures added together. A point asserting that total would
// be asserting the clear bonus too, and a build with a correct interest and a
// wrong bonus would fail this item as well as `economy.wave-clear-bonus` — a grade
// could then no longer say which one the build got wrong. Three clears are driven
// instead, identical in every way but the money the run held going in: `0`, `100`
// and `200`. The clear bonus is the same in all three, whatever this build pays
// for it, so the way the PAYMENT GROWS with the money on hand is the interest and
// nothing else.
//
// THE STEP IS `100`, AND THAT IS WHY THE EXPECTED FIGURE IS EXACT. The rate acts
// on a whole number of money rounded down, and `INTEREST_RATE * 100` is `8`
// exactly, a whole number — so `floor(0.08 * (m + 100))` is `floor(0.08 * m) + 8`
// for every `m`, whatever the clear bonus added underneath it and wherever the
// rounding falls. Two steps are read rather than one, so a build whose payment
// grows in a jump or a stair rather than at a rate is caught: both steps must be
// `8`.
//
// EVERY LEG STAYS WELL UNDER THE CEILING. specs/economy.md caps the payment at
// `40`, which a compliant build reaches at `500` on hand; the largest balance any
// leg presents the rate with is `200` plus the bonus. So the cap is not part of
// this reading, and `economy.interest-capped` reads it on its own.
//
// EACH WAVE IS CLEARED BY A LEAK, which pays nothing of its own
// (economy/payment.ts), so no bounty enters the reading, and each leg opens from
// `startRun`, which resets first, so it is a fresh run rather than a clear posed
// on top of the last one's build phase. The wave cleared is Wave 1 of a
// twenty-wave Containment Medium run, so the clear opens a build phase rather than
// the victory screen — specs/waves.md ends the run instead of opening one on the
// final wave, and a run that ends pays no interest at all.
//
// WHAT EVERY WRONG MODEL READS. A build that pays no interest reads steps of `0`;
// one that pays a flat figure reads `0`; one at `5%` reads `5`; one at `10%` reads
// `10`; one that pays a percentage of the STARTING money rather than the money on
// hand reads `0`. Each is a different step from `8`.

import { afterEach, beforeEach, it } from "vitest";
import { INTEREST_RATE } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./payment";

/** The wave cleared in every leg: an ordinary wave, well short of the run's last. */
const WAVE = 1;

/** The money each leg holds going into its clear. */
const PURSES: readonly number[] = [0, 100, 200];

/** How much more money each leg holds than the one before it. */
const STEP = PURSES[1] - PURSES[0];

/**
 * What each further `STEP` of money on hand must add to the payment.
 *
 * `INTEREST_RATE * STEP` is `8`, a whole number, which is what makes this exact:
 * `floor(0.08 * (m + 100))` is `floor(0.08 * m) + 8` for every `m`. There is no
 * tolerance on it and there cannot be one — money is a whole number and
 * specs/economy.md fixes the rate exactly — so the assertion is equality.
 */
const EXPECTED = INTEREST_RATE * STEP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Open a fresh run at the end of Wave 1 holding `purse`, leak its last unit away,
 * and hand back what the transition paid in total.
 */
async function clearHolding(
  purse: number,
): Promise<{ paid: number; cleared: boolean }> {
  startRun(h);
  poseWaveEnd(h, WAVE);
  h.debug.setMoney(purse);
  poseLeaker(h);

  const before = h.snapshot().money;
  const cleared = await runUntilLeaked(h);
  return { paid: h.snapshot().money - before, cleared };
}

it("pays 8 more for every 100 on hand when a build phase opens", async () => {
  const paid: number[] = [];
  for (const purse of PURSES) {
    const leg = await clearHolding(purse);
    assertTrue(
      leg.cleared,
      `precondition: the last unit left the floor holding ${purse}`,
    );
    paid.push(leg.paid);
  }

  captureStill(h, "interest");
  for (let index = 1; index < paid.length; index += 1) {
    assertEqual(
      paid[index] - paid[index - 1],
      EXPECTED,
      `the payment ${PURSES[index]} on hand added over ${PURSES[index - 1]}`,
    );
  }
});
