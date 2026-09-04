// resonance/no-decay — the meter does not decay with time.
//
// THE RULE. `specs/resonance.md`, among the meter's four standing rules: "It does
// not decay with time." Ten seconds of live play is twenty times `DISCHARGE_TIME`
// and twice `INVERSION_TIME` — long enough that a drain of even a point a second
// is unmistakable, and long enough that a build draining a percentage per second
// has lost most of the meter.
//
// THE FIELD IS EMPTY AND ITS THREE GATES ARE SHUT, and that is what makes this a
// reading of the meter rather than of the environment. `specs/resonance.md` gives
// the meter exactly two fills and one spend, and every one of them is an EVENT: a
// scenario that let the stage's own wave fly in, dive and fire would have the
// hull absorbing bullets and the ship losing lives underneath the reading, so the
// number at the end would be the sum of the requirement and the weather.
// `startPosed` empties the four rosters and shuts `waveEntry`, `diveLaunching`
// and `ship.contact`, so nothing that could legitimately move the meter is on the
// field and what remains is time alone.
//
// TIME IS REAL GAME TIME, NOT A POSE. The ten seconds are run through the build's
// own `update`, frame by frame at the suite's own clock, so a build that decays
// the meter on a timer, in an update, or per frame all reach the reading.
//
// THE POSE IS HALF THE CEILING. Half is the review item's own figure, and it is
// the one value at which a drain and a fill are told apart: a decay reads below
// it, and a build that instead creeps upward with time reads above it.
//
// WHAT THIS DOES NOT DECIDE. That a life loss leaves the meter alone is
// `resonance/kept-on-death`; that the discharge is the only thing that lowers it
// is `resonance/discharge-spends`.

import { afterEach, beforeEach, it } from "vitest";
import { RESONANCE_MAX } from "../constants";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the meter is posed, in meter points: half the ceiling.
 *
 * The review item's own figure ("the meter posed at half"), and the one value
 * with room on both sides, so a build that drains and a build that creeps upward
 * are both caught rather than one of them being clamped out of sight.
 */
const POSED_METER = RESONANCE_MAX / 2;

/**
 * Seconds of live play the meter is held through.
 *
 * The review item's own span. Twenty times `DISCHARGE_TIME` (`0.5`) and twice
 * `INVERSION_TIME` (`5.0`), so any decay expressed against either of the game's
 * own durations has had ample time to show.
 */
const HELD_SECONDS = 10;

/**
 * Decimal places the meter is read to.
 *
 * `specs/resonance.md` states the meter's figures as whole numbers, so the only
 * slack allowed is the round-off of a build that carries the meter as a fraction
 * of `RESONANCE_MAX` and reports it scaled: 5e-7 over ten seconds is far tighter
 * than any decay a build could call incidental, and far looser than the round-off
 * twelve hundred frames of arithmetic can produce.
 */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the meter at half through ten seconds of live play", async () => {
  startPosed(h);
  h.debug.setResonance(POSED_METER);

  assertCloseTo(
    h.snapshot().resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the hold is measured from",
  );

  await h.advanceSeconds(HELD_SECONDS);
  captureStill(h, "held");

  assertCloseTo(
    h.snapshot().resonance,
    POSED_METER,
    METER_DIGITS,
    `the meter after ${HELD_SECONDS} seconds of live play with nothing on the ` +
      `field: unchanged, since the meter does not decay with time ` +
      `(specs/resonance.md)`,
  );
});
