// pressure/feed-multiplier — pressure multiplies the lead segment's speed.
//
// WHAT THE SPEC FIXES. `specs/channel.md` ("The effective feed speed") states it
// exactly:
//
//   effective feed speed = level feed speed x (1 + pressure / 100) x choke factor
//
// with "The lead segment advances at the effective feed speed" and, under
// Advance, "Each tick a segment's rate times the tick's elapsed time is added to
// the arc position of every core in it". `specs/progression.md` fixes level 1's
// feed speed at 22 units/s, and no choke is granted here, so
// `specs/machinery.md` leaves the choke factor at 1. At a pressure of 50 the lead
// segment therefore rides at 22 x 1.5 = 33 units/s.
//
// THE PRESSURE DOES NOT STAND STILL, AND THE SPEC SAYS SO. A lone core is one
// core, which is under `PRESSURE_FREE` (`24`), so `specs/channel.md` bleeds the
// posed 50 away at 2.0 per second while the measurement runs. "The order of a
// tick" advances the train at step 2 and moves the pressure at step 5, so tick n
// rides at the pressure the previous tick left, and the second's arc gain is the
// sum below rather than a flat 33. It comes to 32.78: the item's own drive states
// 33 +/- 0.7, which is the same claim with the second's bleed rounded away, and
// this check asserts the figure the spec's own arithmetic gives instead. The two
// bands overlap almost entirely, so nothing turns on the difference; the spec is
// simply the thing being asserted.
//
// THE DRIVE. An isolated hall at level 1 with the inlet held so it
// delivers nothing that could join the core and change which segment leads, the
// pressure posed at 50, and exactly one core on the channel. A lone core is a
// segment of one and it holds the head, so it is the lead segment
// (`specs/channel.md` — "the lead segment is the one containing the head") and it
// rides at the effective feed speed rather than the fixed catch-up rate. It is
// posed at s = 1000, far from the intake at 5000 and from the inlet, so nothing
// arrives, nothing is emitted, and no clamp is met.
//
// THE TOLERANCE. `FEED_MULTIPLIER_TOL`, the +/- 0.7 units of arc the review item
// states for itself. A tick is exactly 1/60 s, so the only spread a conformant
// build has is where in its tick it moves the pressure, which is worth under a
// hundredth of a unit over the second; the band swallows that many times over and
// still fails a build that drops the multiplier (22 units, sixteen bands away) or
// applies it as a raw pressure rather than a hundredth of one.
//
// WHERE THE BAND IS CENTRED, AND WHY IT IS NOT ON THE 33 THE ITEM NAMES. The
// item's comment reads "confirm it gained 33 units of arc (+/- 0.7)", 33 being
// `22 x (1 + 50/100)` held flat for the second. But a LONE core is one core,
// which is under `PRESSURE_FREE` (24), so specs/channel.md bleeds the posed 50
// away at 2.0/s while the measurement runs and the pressure the last tick rides
// under is 48. Integrating the spec's own tick order gives 32.7837, not 33.0 —
// so the centre is re-derived from the spec below rather than taken from the
// comment, and the item's own +/- 0.7 comfortably contains both figures. This is
// a rounding in the comment rather than a disagreement about the rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  FEED_MULTIPLIER_TOL,
  PRESSURE_BLEED,
  PRESSURE_FREE,
  PRESSURE_MAX,
  PRESSURE_MIN,
  PRESSURE_RISE_PER_CORE,
  TICK_DT,
  effectiveFeed,
  type ChargeId,
} from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  head,
  poseHall,
  spacedBlock,
  type Harness,
} from "../harness";

/** The level whose feed speed the multiplier scales: 22 units/s. */
const LEVEL = 1;

/** The pressure posed, which the spec turns into a multiplier of 1.5. */
const START_PRESSURE = 50;

/** One core, which is the lead segment on its own. */
const CORES = 1;

/** Where the core is posed: clear of the inlet and of the intake at 5000. */
const START_S = 1000;

/** The measured span. Over the standing tolerance's floor of 30 ticks. */
const TICKS = 60;

/** The charge the core carries; nothing here turns on which it is. */
const CHARGE: ChargeId = "halide";

/**
 * The arc the spec's own arithmetic gives over the measured span.
 *
 * Each tick adds the effective feed speed at the pressure the tick opens with,
 * times the tick's elapsed time ("The order of a tick": advance at step 2,
 * pressure at step 5), and then moves the pressure by that tick's rise and bleed.
 */
const EXPECTED_GAIN = (() => {
  let pressure = START_PRESSURE;
  let gain = 0;
  for (let tick = 0; tick < TICKS; tick += 1) {
    gain += effectiveFeed(LEVEL, pressure) * TICK_DT;
    const rise = Math.max(0, CORES - PRESSURE_FREE) * PRESSURE_RISE_PER_CORE;
    const bleed = CORES <= PRESSURE_FREE ? PRESSURE_BLEED : 0;
    pressure = Math.min(
      Math.max(pressure + (rise - bleed) * TICK_DT, PRESSURE_MIN),
      PRESSURE_MAX,
    );
  }
  return gain;
})();

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("rides the lead segment at the level's feed speed times 1 + pressure / 100", async () => {
  await poseHall(harness, {
    level: LEVEL,
    pressure: START_PRESSURE,
    cores: spacedBlock(START_S, CORES, CHARGE),
  });

  const before = await harness.snapshot();
  assertEqual(coreCount(before), CORES, "the posed core on the channel");

  const after = await captureReplay(harness, "fast", () => harness.step(TICKS));

  assertEqual(
    coreCount(after),
    CORES,
    "the posed core still on the channel after the measured second",
  );
  assertNear(
    head(after).s - head(before).s,
    EXPECTED_GAIN,
    FEED_MULTIPLIER_TOL,
    `arc gained over ${TICKS} ticks at level ${LEVEL} under a pressure of ` +
      `${START_PRESSURE}`,
  );
});
