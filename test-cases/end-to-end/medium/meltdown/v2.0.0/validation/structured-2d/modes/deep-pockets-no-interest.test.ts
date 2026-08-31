// Meltdown — modes/deep-pockets-no-interest: a Deep Pockets build phase pays no
// interest at all.
//
// THE RULE. `specs/modes.md`, Deep Pockets: it "pays no interest on entering a
// build phase", and the derived-figures table gives its Interest column `no`.
// `specs/economy.md` says what that suppresses: the Interest line pays
// `min(floor(INTEREST_RATE * money), INTEREST_CAP)` "On entering a build phase
// between waves", and "a mode whose `interest` reads false pays none at all".
//
// TWO READINGS, BECAUSE THE ITEM IS TWO HALVES OF ONE REQUIREMENT: the derived
// `interest` flag reads false, and the transition it governs actually pays
// nothing. A build can get either without the other — a flag it never consults,
// or a payment suppressed by accident on a flag that reads true — and a mode that
// advertises no interest while paying it is exactly the fault this item exists
// to catch.
//
// THE BUILD PHASE IS ENTERED, NOT POSED. `setPhase` "runs no entry effect" and
// specifically "pays interest" is named among the effects it does not run
// (`specs/instrumentation.md`), so the phase is reached the way the run reaches
// it: `specs/waves.md` clears a wave "on the frame in which its last live unit
// dies or leaks with none of it left to release", and on that frame "a build
// phase for the next wave begins... and its interest paid".
//
// WHY THIS POINT READS A SLOPE RATHER THAN A TOTAL. The transition that would pay
// the interest also pays the wave-clear bonus, so the balance after a clear is two
// figures added together and a point asserting the total would be asserting the
// bonus too — a build with a right suppression and a wrong bonus would fail this
// item as well as `economy.wave-clear-bonus`, and a grade could no longer say
// which one the build got wrong. Two clears are driven instead, identical in
// every way but the money the run held going in. The clear bonus is the same in
// both, whatever this build pays for it, so the way the payment GROWS with the
// money on hand is the interest and nothing else — and on this mode it must not
// grow at all.
//
// WHY THE TWO PURSES ARE `0` AND `500`. `specs/economy.md` caps the payment at
// `40`, which `INTEREST_RATE` reaches at `500` on hand, so an interest-paying
// build separates these two legs by the largest margin the rule allows: `38`
// against the `0` this mode requires. A smaller step would still separate them,
// but this one puts the wrong model at the ceiling rather than at a rounding
// boundary.
//
// EACH LEG CLEARS WAVE 1 OF THE MODE'S TWENTY, so the clear opens a build phase
// rather than the victory screen — `specs/waves.md` ends the run instead of
// opening one on the final wave, and a run that ends pays no interest at all,
// which would make every build pass. Each leg opens from `startRun`, which resets
// first, so it is a fresh run rather than a clear posed on top of the last one's
// build phase, and the clear is reached by a LEAK, which pays nothing of its own
// (`modes/ending.ts`), so no bounty enters either reading.
//
// WHAT EVERY WRONG MODEL READS. A build that pays the standard `8%` on this mode
// reads a step of `38`; one that pays half that reads `20`; one that suppresses
// the payment but still advertises the mode as interest-bearing reads a step of
// `0` and fails on the flag instead. Only a build that both reads `false` and
// pays nothing clears both halves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./ending";

/** The mode this point reads. */
const MODE = "deeppockets";

/** The wave cleared in both legs: an ordinary wave, well short of the run's last. */
const WAVE = 1;

/**
 * The money each leg holds going into its clear.
 *
 * `500` is where `specs/economy.md`'s rate meets its `40` ceiling, so an
 * interest-paying build is separated from a compliant one by the widest margin
 * the rule allows.
 */
const PURSES: readonly number[] = [0, 500];

/**
 * What each further purse must add to the payment: nothing.
 *
 * There is no tolerance on it and there cannot be one — money is a whole number
 * of coins and `specs/modes.md` fixes the mode's interest as `no` — so the
 * assertion is equality with zero.
 */
const EXPECTED = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Open a fresh Deep Pockets run at the end of Wave 1 holding `purse`, leak its
 * last unit away, and hand back what the transition paid.
 */
async function clearHolding(purse: number): Promise<{
  paid: number;
  cleared: boolean;
  opened: string;
}> {
  startRun(h, MODE);
  poseWaveEnd(h, WAVE);
  h.debug.setMoney(purse);
  poseLeaker(h);

  const before = h.snapshot().money;
  const cleared = await runUntilLeaked(h);
  const after = h.snapshot();
  return { paid: after.money - before, cleared, opened: after.phase };
}

it("pays nothing on entering a build phase, whatever the money on hand", async () => {
  startRun(h, MODE);
  assertEqual(
    h.snapshot().interest,
    false,
    "whether Deep Pockets derives that it pays interest",
  );

  const paid: number[] = [];
  for (const purse of PURSES) {
    const leg = await clearHolding(purse);
    assertTrue(
      leg.cleared,
      `precondition: the last unit left the floor holding ${String(purse)}`,
    );
    assertEqual(
      leg.opened,
      "building",
      `precondition: the phase the clear opened holding ${String(purse)}`,
    );
    paid.push(leg.paid);
  }

  captureStill(h, "balance");

  assertEqual(
    paid[1] - paid[0],
    EXPECTED,
    `the payment ${String(PURSES[1])} on hand added over ${String(PURSES[0])}`,
  );
});
