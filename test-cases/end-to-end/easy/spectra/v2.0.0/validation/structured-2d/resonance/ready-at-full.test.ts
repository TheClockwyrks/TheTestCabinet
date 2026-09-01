// resonance/ready-at-full — a discharge is available exactly at `RESONANCE_MAX`,
// and not one point below.
//
// THE RULE. specs/resonance.md: "A discharge is available exactly when the meter
// reads `RESONANCE_MAX`, and not one point below."
// specs/instrumentation.md reports that availability as `dischargeReady`,
// "derived: `resonance >= RESONANCE_MAX`", and says every derived reading follows
// the operation that sets what it is derived from — so `setResonance` alone
// decides it and no frame has to run for the snapshot to say so.
//
// THE BOUNDARY IS READ FROM BOTH SIDES, which is the whole of this point: a build
// that reports itself ready at every reading and a build that never reports
// itself ready must grade differently, and only the pair of readings separates
// them. They are one requirement — where the threshold sits — rather than two,
// and the pose is the closest pair of values the meter's own whole-number figures
// allow, so a build whose threshold is off by as little as one point fails.
//
// WHAT THIS DOES NOT DECIDE. What the action DOES at each of those two readings
// is `resonance/discharge-spends` and `resonance/discharge-locked`: this point
// reads the flag and nothing else, so a build whose flag is right and whose
// action is wrong loses those points and keeps this one.

import { afterEach, beforeEach, it } from "vitest";
import { RESONANCE_MAX } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The reading one point below the ceiling, in meter points.
 *
 * The review item's own figure. One point is the smallest step
 * specs/resonance.md's whole-number figures allow, so a build reporting itself
 * ready here has a threshold below `RESONANCE_MAX` by at least that much.
 */
const JUST_SHORT = RESONANCE_MAX - 1;

/** Decimal places the posed meter is read back to: round-off only. */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports dischargeReady false one point short of RESONANCE_MAX and true at it", async () => {
  startPosed(h);

  h.debug.setResonance(JUST_SHORT);
  const short = h.snapshot();
  assertCloseTo(
    short.resonance,
    JUST_SHORT,
    METER_DIGITS,
    "precondition: the meter was posed one point below its ceiling",
  );
  assertEqual(
    short.dischargeReady,
    false,
    `dischargeReady with the meter at ${JUST_SHORT}, one point below ` +
      `RESONANCE_MAX (${RESONANCE_MAX}): a discharge is available exactly at ` +
      `the ceiling and not one point below (specs/resonance.md)`,
  );

  h.debug.setResonance(RESONANCE_MAX);
  const full = h.snapshot();

  // One frame so the still shows the HUD strip drawn with the meter full. Both
  // readings are taken off the snapshot, which derives `dischargeReady` at the
  // call, so nothing about this frame decides the verdict.
  await h.advance(1);
  captureStill(h, "ready");

  assertCloseTo(
    full.resonance,
    RESONANCE_MAX,
    METER_DIGITS,
    "precondition: the meter was posed at its ceiling",
  );
  assertEqual(
    full.dischargeReady,
    true,
    `dischargeReady with the meter at RESONANCE_MAX (${RESONANCE_MAX}): a ` +
      `discharge is available exactly there (specs/resonance.md)`,
  );
});
