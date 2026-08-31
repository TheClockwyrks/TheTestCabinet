// saucer/wraps-top-and-bottom — a saucer driven off the top edge comes back at
// the bottom.
//
// THE RULE. `specs/saucer.md`, Entry and travel: "It wraps at the top and bottom
// edges like any body." `specs/field.md` fixes what that means — the field is a
// torus and a coordinate is kept in range by taking it modulo the field size on
// that axis — so a centre carried to `y = -15` re-enters at `y = 705` and not
// anywhere else.
//
// WHY THE TOP AND THE BOTTOM. They are the two edges the saucer's own motion takes
// it through: its cruise is horizontal and its weave is vertical, so the vertical
// seam is the one a visit actually meets.
//
// WHAT IS READ, AND WHY A FIGURE RATHER THAN A SIDE. The centre after the seam has
// been crossed, against the coordinate the modulus puts it at. Four wrong models
// each read as a different number: a build that CLAMPS the coordinate to the edge
// reads `720` (or `0`), one that REFLECTS reads `+15`, one that re-enters a radius
// late reads `687`, and one that ends the visit at the edge reports no saucer at
// all. Only the modulus reads `705`. The column is read with it, because the wrap
// is a translation on one axis and leaves the other exactly as it was.
//
// THE COURSE IS VERTICAL AND NOTHING ELSE. `setSaucerVelocity(0, -SAUCER_WEAVE_SPEED)`
// gives the craft the fastest vertical motion `specs/saucer.md` gives it and no
// horizontal motion at all, so the crossing is the requirement and the column is a
// constant. `setSaucerMind(false)` stops the weave rerolling that velocity out
// from under the reading — the item states the pose is made "with its mind off" —
// and `setSaucerGun(false)` leaves the crossing free of rounds. The travel is
// left ON, because the motion IS the requirement.
//
// WHY THIS COLUMN. `420` is clear of the star's whole drawn extent — nothing of
// the star is drawn beyond `1.5 x HALO_R` (`180`) of its centre — and clear of the
// ship at its safe point, so the crossing is the only thing in the frame. Nothing
// on the field can touch the craft in any case: `specs/collision.md` pairs the
// core with a bullet, a rock and the ship, and not with the saucer.
//
// THE TOLERANCE IS A HALF-UNIT. A saucer is powered, undragged and never pulled by
// the well (`specs/gravity.md`), so a conformant centre after the crossing is the
// modulus of its own motion to floating-point precision. Half a unit is a
// thirtieth of the `15` units of overshoot the pose builds in — which is what a
// build that clamps to the edge misses by — and a thirty-sixth of `SAUCER_R`
// (`18`), so a build that wraps on the craft's edge rather than its centre fails.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_H, SAUCER_WEAVE_SPEED } from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";
import { wrapCoordinate } from "../geometry";

/** The column the crossing is flown along. See the header for why this one. */
const COLUMN = 420;

/** How far below the top edge the craft starts, in units. */
const START_Y = 30;

/** The vertical speed it is driven at: the fastest the specification gives it. */
const CLIMB = SAUCER_WEAVE_SPEED;

/** The whole ticks driven: enough to carry the centre 45 units, 15 past the seam. */
const TICKS = 60;

/** Where the modulus puts the centre after those ticks. */
const EXPECTED = wrapCoordinate(START_Y - CLIMB * seconds(TICKS), FIELD_H);

/** How far from that the reading may sit, in units. See the header. */
const TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-enters at the bottom edge with the column it left the top on", async () => {
  startPlaying(h);
  poseSaucer(h, COLUMN, START_Y);
  h.debug.setSaucerVelocity(0, -CLIMB);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);

  await h.advance(TICKS);
  const after = requireSaucer(
    h.snapshot(),
    "the saucer still on the field after it crossed the top edge — a wrap " +
      "carries a body round, it does not end its visit (specs/field.md)",
  );
  // The saucer re-entering at the opposite edge.
  captureStill(h, "wrap");

  assertGreaterThan(
    after.y,
    FIELD_H / 2,
    `the saucer's centre y after ${TICKS} ticks climbing at ${CLIMB} units per ` +
      `second from y = ${START_Y} — it left the top edge and must be in the ` +
      "bottom half of the field (specs/saucer.md, specs/field.md)",
  );
  assertLessThanOrEqual(
    Math.abs(after.y - EXPECTED),
    TOLERANCE,
    `how far the saucer's centre y missed ${EXPECTED} by, which is where the ` +
      `field's modulus puts a centre carried to ${(START_Y - CLIMB * seconds(TICKS)).toFixed(1)} ` +
      "(specs/field.md)",
  );
  assertLessThanOrEqual(
    Math.abs(after.x - COLUMN),
    TOLERANCE,
    `how far the saucer's centre x moved from the column ${COLUMN} it was ` +
      "flown along — the vertical wrap leaves the other axis exactly as it was " +
      "(specs/field.md)",
  );
});
