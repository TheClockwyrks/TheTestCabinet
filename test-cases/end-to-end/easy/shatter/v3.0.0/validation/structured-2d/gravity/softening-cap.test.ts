// gravity/softening-cap — inside the softening radius the pull stops growing.
//
// THE RULE. `specs/gravity.md`, "The law": `dEff = max(d, SOFTEN)` with `SOFTEN`
// = `90`, and the file spells out what that means — "inside `SOFTEN` the
// magnitude is capped at `MU / (SOFTEN * SOFTEN)`, so a body approaching the core
// is pulled no harder than a body at `d = 90`" — and tabulates the figure:
// `d <= 90` gives `555.6` units per second squared.
//
// This is the one edge case in the law, and it is its own item so that a build
// which has the inverse square right and the softening wrong fails HERE and
// passes `gravity/pull-magnitude`, naming exactly what it got wrong.
//
// WHAT IS READ, AND WHY 60 UNITS SEPARATES THE TWO MODELS. The speed a round
// posed at rest 60 units from the star gains over one tick. The two models give
// numbers that are nowhere near each other:
//
//     capped (the rule)      MU / 90^2  * TICK_DT  =  4.62963 units per second
//     uncapped (the fault)   MU / 60^2  * TICK_DT  = 10.41667 units per second
//
// The fault reads 2.25 times the rule — 125 percent away, twenty-five times the 5
// percent this check allows — so no tolerance can let one pass for the other.
// Sixty units
// is two thirds of `SOFTEN`, far enough inside it that a build whose cap is off
// by a few units still reads the capped figure, and it clears the star's core —
// `specs/collision.md` absorbs a round that reaches `CORE_R + BULLET_R` (`33`),
// and this one is posed at 60 and moves four hundredths of a unit over the tick.
//
// The bearing is `145` degrees rather than an axis, for the reason
// `gravity/pull-magnitude`'s header gives: on an axis, `d` and `|dy|` are the
// same number, so a build measuring the distance along an axis would read right.
//
// WHY THIS READS THE MAGNITUDE ONLY. The cap is a rule about how hard, not about
// which way — `specs/gravity.md` caps `aMag` and leaves the unit vector alone —
// so which way the pull points inside the softening radius is
// `gravity/pull-direction`'s item, at its own distance.
//
// WHY 5 PERCENT. The figure the review item states, and the same one
// `gravity/pull-magnitude` spends, for the same reason: a body at rest reads the
// law with no integrator between it and the answer, so it leaves room for a build
// that rounds `MU` and for nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { MU, SOFTEN, TICK_DT } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { DEG, speedOf } from "../geometry";
import { aroundTheStar, gainsAtRest } from "./well";

/** How far inside the softening radius the round is posed, in units. */
const DISTANCE = 60;

/** The bearing it is posed on: off-axis, so `d` is a genuine hypotenuse. */
const BEARING = 145 * DEG;

/** The speed the CAPPED law gives over one tick, in units per second. */
const CAPPED = (MU / (SOFTEN * SOFTEN)) * TICK_DT;

/** The speed an UNCAPPED build would give at 60 units — 2.25 times as much. */
const UNCAPPED = (MU / (DISTANCE * DISTANCE)) * TICK_DT;

/**
 * How far the reading may fall from the capped figure, as a fraction of it.
 *
 * 5 percent, the figure the review item states. The uncapped model is 125 percent
 * away, so this cannot admit it.
 */
const TOLERANCE_FRACTION = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("caps the pull at MU / SOFTEN^2 for a body inside the softening radius", async () => {
  startPlaying(h);

  const at = aroundTheStar(DISTANCE, BEARING);
  const [gained] = await gainsAtRest(h, [at]);

  // The round posed inside the softening radius, on the tick it was read on.
  captureStill(h, "sample");

  assertLessThanOrEqual(
    Math.abs(speedOf(gained) - CAPPED),
    TOLERANCE_FRACTION * CAPPED,
    `the speed a body at rest ${DISTANCE} units from the star gains over one ` +
      `tick: MU (${MU}) / SOFTEN (${SOFTEN})^2 over TICK_DT, which is ` +
      `${CAPPED.toFixed(5)} units per second, NOT the ${UNCAPPED.toFixed(5)} an ` +
      `uncapped MU / ${DISTANCE}^2 would give (specs/gravity.md)`,
  );
});
