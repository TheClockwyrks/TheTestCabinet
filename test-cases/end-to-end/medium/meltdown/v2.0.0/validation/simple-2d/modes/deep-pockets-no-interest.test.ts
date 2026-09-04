// modes/deep-pockets-no-interest — Deep Pockets pays nothing on entering a build
// phase.
//
// THE RULE. specs/modes.md, Deep Pockets: "Deep Pockets opens on `10000` money and
// pays no interest on entering a build phase", and its table reads `no` under
// Interest. specs/economy.md pays the Interest line "On entering a build phase
// between waves", and specs/waves.md fixes how that phase is entered: a wave clears,
// "the wave number rises by one and a build phase for the next wave begins, with its
// timer at `BUILD_PHASE_TIME` and its interest paid". So the transition is reached
// the way the run reaches it — a wave cleared — because `setPhase` "runs no entry
// effect" and paying the interest is exactly the effect under test
// (specs/instrumentation.md).
//
// WHY THIS POINT READS A SLOPE RATHER THAN A TOTAL. The transition that would pay
// the interest also pays the wave-clear bonus. A point asserting the balance after
// the clear would be asserting that bonus too, and a build with the right interest
// and a wrong bonus would fail this item as well as `economy.wave-clear-bonus` — a
// grade could then no longer say which one the build got wrong. Two clears are
// driven instead, identical in every way but the money the run held going in: `0`
// and `200`. The clear bonus is the same in both, whatever this build pays for it,
// so the way the PAYMENT GROWS with the money on hand is the interest and nothing
// else, and on Deep Pockets it must not grow at all.
//
// THE STEP IS `200` BECAUSE THAT IS WHERE A CONFORMANT RATE IS UNMISTAKABLE.
// specs/economy.md's rate is `floor(0.08 * money)` capped at `40`, so a build that
// paid Containment's interest here would read a step of `16` — a sixteenth of the
// step itself, far above any rounding, and well under the `40` cap so the ceiling is
// not what hides it. A build paying a flat sum per build phase reads `0` and passes
// this reading, which is correct: a flat payment is not interest, and whether a mode
// pays some other line is `economy`'s business. The FLAG is what catches that build,
// and it is read here beside the slope.
//
// EACH LEG IS A FRESH RUN, opened from `startRun`, which resets first — so the second
// clear is not posed on top of the build phase the first one opened. The wave
// cleared is Wave 1 of Deep Pockets' twenty-wave run, so the clear opens a build
// phase rather than the victory screen; specs/waves.md ends the run instead of
// opening one on the final wave, and a run that ends pays no interest at all.
//
// EACH WAVE IS CLEARED BY A LEAK, which specs/economy.md gives no payment of its own
// — "A unit that reaches its exhaust pays no bounty", and it scores nothing — so no
// bounty enters either reading.
//
// TWO READINGS, ONE PER CLAUSE. The slope: `0`, exactly, money being a whole number
// and the specification fixing the figure outright. And the flag: `interest` reads
// `false`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./run";

/** The mode this point is about. */
const MODE = "deeppockets";

/** The wave cleared in both legs: an ordinary wave, well short of the run's last. */
const WAVE = 1;

/** The money each leg holds going into its clear. */
const PURSES: readonly number[] = [0, 200];

/**
 * What the second leg's payment may exceed the first's by: nothing.
 *
 * There is no tolerance on it and there cannot be one — money is a whole number and
 * specs/modes.md fixes the figure outright — so the assertion is equality.
 */
const EXPECTED_STEP = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Open a fresh Deep Pockets run at the end of Wave 1 holding `purse`, leak its last
 * unit away, and hand back what the transition paid in total.
 */
async function clearHolding(
  purse: number,
): Promise<{ paid: number; cleared: boolean }> {
  startRun(h, MODE);
  poseWaveEnd(h, WAVE);
  h.debug.setMoney(purse);
  poseLeaker(h);

  const before = h.snapshot().money;
  const cleared = await runUntilLeaked(h);
  return { paid: h.snapshot().money - before, cleared };
}

it("pays nothing more for money on hand when a Deep Pockets build phase opens", async () => {
  const paid: number[] = [];
  for (const purse of PURSES) {
    const leg = await clearHolding(purse);
    assertTrue(
      leg.cleared,
      `precondition: the last unit left the floor holding ${purse}`,
    );
    paid.push(leg.paid);
  }
  captureStill(h, "balance");

  assertEqual(
    paid[1] - paid[0],
    EXPECTED_STEP,
    `the payment ${PURSES[1]} on hand added over ${PURSES[0]}, Deep Pockets ` +
      "paying no interest (specs/modes.md, Deep Pockets)",
  );
  assertEqual(
    h.snapshot().interest,
    false,
    "whether Deep Pockets pays interest (specs/modes.md, The derived figures)",
  );
});
