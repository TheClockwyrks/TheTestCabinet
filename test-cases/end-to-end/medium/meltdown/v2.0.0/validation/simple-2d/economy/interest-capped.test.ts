// economy/interest-capped — the interest payment stops at 40.
//
// specs/economy.md's income table: the Interest line pays
// `min(floor(INTEREST_RATE * money), INTEREST_CAP)`, "which is
// `floor(0.08 * money)` capped at `40`". At `10,000` on hand the uncapped
// percentage would be `800`; the ceiling is what makes the payment `40`. The
// transition is reached the way the run reaches it — a wave cleared opening a
// build phase (specs/waves.md) — because `setPhase` runs no entry effect
// (specs/instrumentation.md).
//
// WHY `10,000` IS THE MONEY POSED. It is twenty times the `500` at which a
// compliant payment first reaches the ceiling, so no rounding and no near-miss can
// put a conformant build near the line: an uncapped build reads a figure twenty
// times the cap, and a build that capped at some other figure reads that figure.
// `10,000` is also `DEEP_POCKETS_MONEY` (specs/modes.md), a sum a player really
// does hold, so the pose is a balance the game reaches rather than an invented
// extreme.
//
// WHAT THIS READING RESTS ON BESIDES THE CAP, STATED PLAINLY. The transition that
// pays the interest pays the wave-clear bonus first, and the two land in the same
// balance, so the interest cannot be read from the money without taking the bonus
// off. There is no way around it: in a mode that pays interest at all, the bonus is
// always underneath the percentage. The bonus subtracted here is specs/economy.md's
// own figure for Wave 1, `20 + 5 * 1`, which `economy.wave-clear-bonus` decides on
// its own in a mode that pays no interest — so a build that pays the wrong clear
// bonus fails that item, and this reading is off by the same amount. The wave read
// is `1`, whose bonus is the SMALLEST any wave pays, so what is subtracted from the
// reading is as small as this game allows it to be.
//
// THE WAVE CLEARED IS BELOW THE RUN'S LAST. Containment Medium runs twenty waves
// (specs/modes.md), so clearing Wave 1 opens a build phase — the one transition
// interest is paid on — rather than ending the run, which pays none.
//
// THE WAVE IS CLEARED BY A LEAK, which pays nothing of its own
// (economy/payment.ts), so no bounty enters the reading.
//
// WHAT EVERY WRONG MODEL READS. A build with no ceiling at all reads `800`; one
// that capped the RATE rather than the payment reads whatever that gives; one that
// pays no interest reads `0`; one whose ceiling is a different figure reads that
// figure. Each is a different number from `40`.

import { afterEach, beforeEach, it } from "vitest";
import {
  DEEP_POCKETS_MONEY,
  INTEREST_CAP,
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

/** The wave cleared: the wave whose clear bonus is the smallest in the game. */
const WAVE = 1;

/** The money the run holds going into the clear: twenty times the cap's threshold. */
const PURSE = DEEP_POCKETS_MONEY;

/** What Wave 1's clear pays alongside the interest (specs/economy.md). */
const WAVE_ONE_BONUS = WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * WAVE;

/**
 * What the interest must be, to the point.
 *
 * There is no tolerance on it and there cannot be one: money is a whole number and
 * specs/economy.md fixes the ceiling exactly, so the assertion is equality.
 */
const EXPECTED = INTEREST_CAP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays 40 rather than 800 with ten thousand on hand", async () => {
  startRun(h);
  poseWaveEnd(h, WAVE);
  h.debug.setMoney(PURSE);
  poseLeaker(h);

  const before = h.snapshot().money;
  const cleared = await runUntilLeaked(h);

  captureStill(h, "capped");
  const paid = h.snapshot().money - before;

  assertTrue(cleared, "precondition: the wave's last unit left the floor");
  assertEqual(
    paid - WAVE_ONE_BONUS,
    EXPECTED,
    "the interest paid with ten thousand on hand",
  );
});
