// economy/interest-follows-the-clear-bonus — the percentage is taken on the money
// the clear bonus left.
//
// specs/economy.md: "Interest is computed after the wave-clear bonus of the same
// transition has landed, so the percentage is taken on the money that bonus left."
// Both are paid on the one transition specs/waves.md describes — a wave clears,
// "the wave number rises by one and a build phase for the next wave begins, with
// its timer at `BUILD_PHASE_TIME` and its interest paid" — so this point is about
// the ORDER of two payments inside one frame, and it reaches that frame the way the
// run reaches it, because `setPhase` runs no entry effect
// (specs/instrumentation.md).
//
// THE PURSE IS POSED EMPTY, AND THAT IS THE WHOLE DESIGN. With `0` on hand going
// into the clear, a build that takes its percentage BEFORE the bonus takes `8%` of
// nothing and pays exactly `0` interest, whatever its rate, whatever its rounding
// and whatever its ceiling. A build that takes it after the bonus takes `8%` of the
// bonus. So the two orders are told apart by a payment that is there at all rather
// than by a figure either could stumble onto, and no rounding boundary sits between
// them.
//
// THE WAVE IS `19`, THE LAST ORDINARY WAVE OF A TWENTY-WAVE RUN. Its bonus is
// `20 + 5 * 19`, `115`, the largest any wave of the standard progression pays, so
// the percentage taken on it is `floor(0.08 * 115)`, `9` — as far from `0` as this
// game's arithmetic can put it. At Wave 1 the same contrast would be `2` against
// `0`, which is a difference a reviewer could mistake for rounding. Being the last
// ORDINARY wave, it clears into a build phase rather than into victory
// (specs/modes.md gives Containment Medium twenty waves), which is the one
// transition interest is paid on.
//
// WHAT THIS READING RESTS ON BESIDES THE ORDER, STATED PLAINLY. The bonus the
// percentage is taken on is the bonus the same transition paid, so the figure
// subtracted here is specs/economy.md's own `20 + 5w`, which
// `economy.wave-clear-bonus` decides on its own in a mode that pays no interest. A
// build that pays the wrong clear bonus fails that item, and the percentage it
// takes on its own wrong bonus lands somewhere else than `9`. That coupling is
// unavoidable: the item IS about how the two payments compose.
//
// THE WAVE IS CLEARED BY A LEAK, which pays nothing of its own
// (economy/payment.ts), so no bounty enters the reading.
//
// WHAT EVERY WRONG MODEL READS. A build that takes the percentage before the bonus
// reads `0`; one that pays no interest reads `0`; one that takes the percentage on
// the money the NEXT wave's bonus will leave reads a larger figure. The
// distinguishing figure is `9`.

import { afterEach, beforeEach, it } from "vitest";
import {
  INTEREST_RATE,
  WAVE_CLEAR_BASE,
  WAVE_CLEAR_PER_WAVE,
} from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./payment";

/** The wave cleared: the last ordinary wave of a twenty-wave run, and the largest bonus. */
const WAVE = 19;

/** The money the run holds going into the clear: nothing at all. */
const PURSE = 0;

/** What clearing wave `WAVE` pays alongside the interest (specs/economy.md). */
const BONUS = WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * WAVE;

/**
 * The interest a percentage taken AFTER the bonus must come to, to the point.
 *
 * There is no tolerance on it and there cannot be one: money is a whole number and
 * specs/economy.md fixes the rate and the rounding exactly, so the assertion is
 * equality. Taken before the bonus, on a purse posed empty, the same figure is `0`.
 */
const EXPECTED = Math.floor(INTEREST_RATE * BONUS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the percentage on the money the clear bonus left, not the money before it", async () => {
  startRun(h);
  poseWaveEnd(h, WAVE);
  h.debug.setMoney(PURSE);
  poseLeaker(h);

  const before = h.snapshot().money;
  const cleared = await runUntilLeaked(h);

  captureStill(h, "order");
  const paid = h.snapshot().money - before;

  assertTrue(cleared, "precondition: wave 19's last unit left the floor");
  assertEqual(
    paid - BONUS,
    EXPECTED,
    "the interest paid on an empty purse the clear bonus had just filled",
  );
});
