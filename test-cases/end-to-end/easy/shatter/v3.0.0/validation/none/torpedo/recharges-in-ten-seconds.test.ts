// torpedo/recharges-in-ten-seconds — a spent charge is full again ten seconds on.
//
// specs/weapons.md, "The charge": the charge "rises linearly from `0` to `1` over
// `TORPEDO_RECHARGE` (`10` seconds) of game time". This item decides the ten
// seconds; `recharge-is-linear` decides the shape of the climb between.
//
// WHAT IS MEASURED IS THE TIME, NOT THE VALUE. The charge is watched from the tick
// the launch spent it until the tick it first reads full, and what is asserted is
// the game time that took. Reading the value at ten seconds instead would pass a
// build that refilled in five, or in one, or on the very next tick — every one of
// which reads `1` at ten seconds and none of which recharges over ten. The time is
// read off `simTime`, which specs/instrumentation.md accumulates every tick's
// `TICK_DT`, so it is the game's own clock rather than the harness's count.
//
// THE THREE PER CENT IS THE MANIFEST'S OWN ALLOWANCE on a ten-second figure:
// three tenths of a second, or 36 ticks of the `TICK_HZ` (`120`) clock
// specs/simulation.md fixes. The charge is sampled every four ticks, a thirtieth
// of a second, so the sampling grain is a tenth of the bound.
//
// THE FIELD IS EMPTY AND QUIET for the whole twelve seconds this may run for.
// `startPlaying` shuts both world gates, so no wave arrives into the flight and no
// saucer joins it at eighteen seconds of game time — and the launched torpedo
// expires at `TORPEDO_LIFE` (`3.5` s) long before the charge is back, which is the
// recharge running with nothing else on the field at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { TORPEDO_RECHARGE } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { chargeOf, poseShip, pressTorpedo, theTorpedo } from "./scene";

/**
 * The charge at which the refill counts as complete.
 *
 * `1`, less a millionth for the arithmetic: a build that accumulates a per-tick
 * increment lands on the last ten-thousandth of the way rather than exactly on
 * `1`, and a millionth of the range is four ten-thousandths of one tick's climb.
 */
const FULL = 1 - 1e-6;

/** How often the charge is read while the refill runs, in ticks. */
const SAMPLE_EVERY = 4;

/** How long the refill is watched for: two seconds past the figure it must meet. */
const WATCH_TICKS = ticksFor(TORPEDO_RECHARGE + 2);

/**
 * How far the measured refill may sit from `TORPEDO_RECHARGE`, in seconds.
 *
 * Three per cent of the ten seconds specs/weapons.md fixes — three tenths of a
 * second. A build that refills instantly reads `0`, one that takes five seconds
 * reads half the figure, and neither is inside this.
 */
const TOLERANCE = 0.03 * TORPEDO_RECHARGE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("brings a spent charge back to full over ten seconds of game time", async () => {
  await startPlaying(h);
  await poseShip(h);

  const fired = await pressTorpedo(h);
  // Hard first: a press that launched nothing spent no charge to refill.
  theTorpedo(fired, "the launch whose refill is being timed");
  const spentAt = fired.simTime;

  const refilled = await h.skipUntil(
    (snapshot) => (snapshot.torpedoCharge ?? 0) >= FULL,
    { maxTicks: WATCH_TICKS, poll: SAMPLE_EVERY },
  );
  // The charge back at full, ten seconds on from the launch.
  await captureStill(h, "recharged");

  if (!refilled.hit) {
    fail(
      `a spent charge back at 1 within ${TORPEDO_RECHARGE + 2} seconds of game ` +
        `time (specs/weapons.md: the charge rises linearly from 0 to 1 over ` +
        `TORPEDO_RECHARGE, ${TORPEDO_RECHARGE} seconds)`,
      `it read ${chargeOf(refilled.snapshot, "the end of the watch")} after ` +
        `${(refilled.snapshot.simTime - spentAt).toFixed(2)} seconds`,
    );
  }

  const took = refilled.snapshot.simTime - spentAt;
  assertLessThanOrEqual(
    Math.abs(took - TORPEDO_RECHARGE),
    TOLERANCE,
    `the seconds of game time a spent charge took to read full, against the ` +
      `TORPEDO_RECHARGE (${TORPEDO_RECHARGE} s) specs/weapons.md fixes; it took ` +
      `${took.toFixed(3)} s`,
  );
});
