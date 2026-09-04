// gravity/direct-not-wrapped — a body in a corner is pulled across the field,
// by its full distance.
//
// THE RULE. `specs/gravity.md`: "the pull uses the body's direct vector to
// `(STAR_X, STAR_Y)`, not a wrapped one, so a body near a corner is pulled by its
// full distance across the field rather than by the distance to a wrapped image
// of the star." `specs/field.md` states it again beside the star. It is the one
// measurement in this game that is NOT taken along the shortest wrapped
// separation, and that is the whole of this item.
//
// THE POSE. A rock at rest 40 units inside a corner — `(40, 40)` and its three
// mirrors. Every one of them is `hypot(600, 320)` = `680` units from
// `(640, 360)`, the longest reach anything in this game has, where
// `specs/gravity.md`'s law gives `MU / 680^2` = `9.7318` units per second squared
// and one tick of it is `0.08110` units per second.
//
// AT REST, ONE TICK, for the reasons `well.ts` gives: nothing but the well
// touches the reading, and the distance the pull was computed at is the distance
// this check posed.
//
// WHAT THE TWO READINGS CATCH. The heading catches the model the rule names — a
// build that pulls the rock toward the nearest wrapped IMAGE of the star pulls it
// OUT through the corner, 180 degrees from the answer. The magnitude catches
// every cheaper measure of "how far", each of which reads as its own number at
// this pose and none of which is inside the bound:
//
//   a range cutoff on the well          0, against 0.08110
//   Manhattan, |dx| + |dy| = 920        0.0443, 45 percent low
//   the larger axis alone, 600          0.1042, 28 percent high
//   the softening cap applied always    4.6296, fifty-seven times
//   the shortest wrapped distance       the same 680 — see the note below
//
// WHAT THIS ITEM CANNOT SEPARATE, STATED PLAINLY. The star stands at the field's
// exact centre (`specs/field.md`), so for EVERY point inside the field the
// shortest wrapped separation to it and the direct separation are the same
// vector: `|dx|` never exceeds `FIELD_W / 2` and `|dy|` never exceeds
// `FIELD_H / 2`. A build that correctly implemented the minimum-image convention
// and used it for the well would therefore read exactly right here, and at every
// other point a body can occupy. What this item decides is the requirement as a
// player can observe it — that a body in the far corner is pulled toward the
// middle of the field, at the strength its full distance across the field gives —
// and it decides that against every wrong model above.
//
// ALL FOUR CORNERS, because a build whose separation has a sign wrong on one axis
// reads right in two of them and reflected in the other two, and one corner alone
// would let it through. The four are one requirement read four ways, not four
// requirements: they share this item's grade.
//
// WHY 5 PERCENT AND ONE DEGREE. The same two bounds `gravity/pull-magnitude` and
// `gravity/pull-direction` spend on the same law, for the same reason: a body at
// rest reads the law with no integrator between it and the answer, so a
// conformant build lands on the figure to floating point.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_H, FIELD_W, TICK_DT } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  type Harness,
} from "../harness";
import {
  DEG,
  STAR,
  angleBetween,
  directDistance,
  directSeparation,
  headingOf,
  pullAt,
  speedOf,
} from "../geometry";

/** How far inside the corner the rock is posed, on each axis, in units. */
const INSET = 40;

/** The four corners, each `INSET` units in on both axes. */
const CORNERS: readonly { name: string; x: number; y: number }[] = [
  { name: "top-left", x: INSET, y: INSET },
  { name: "top-right", x: FIELD_W - INSET, y: INSET },
  { name: "bottom-left", x: INSET, y: FIELD_H - INSET },
  { name: "bottom-right", x: FIELD_W - INSET, y: FIELD_H - INSET },
];

/** The corner whose picture is kept as the item's still. */
const RECORDED = "top-left";

/**
 * How far the reading may fall from the figure the law gives at the direct
 * distance, as a fraction of it.
 *
 * 5 percent, the bound this group spends on every magnitude the law fixes. The
 * nearest wrong measure of the distance is 28 percent away.
 */
const TOLERANCE_FRACTION = 0.05;

/**
 * How far the pull's heading may fall from the heading to the star's centre, in
 * radians.
 *
 * One degree, the bound this group spends on every direction the law fixes. The
 * model the rule names — a pull toward a wrapped image of the star — is 180
 * degrees away.
 */
const HEADING_TOLERANCE = 1 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(CORNERS)(
  "pulls a rock in the $name corner across the field, by its direct distance",
  async ({ name, x, y }) => {
    startPlaying(h);

    const id = poseRock(h, "medium", x, y);
    await h.advance(1);

    // The rock in the corner, on the tick the pull was read on.
    if (name === RECORDED) captureStill(h, "corner");

    const rock = requireRock(
      h.snapshot(),
      id,
      `the rock posed at rest in the ${name} corner still on the field one ` +
        "tick later",
    );

    const posed = { x, y };
    const distance = directDistance(posed, STAR);
    const wanted = pullAt(posed) * TICK_DT;

    assertLessThanOrEqual(
      Math.abs(speedOf(rock) - wanted),
      TOLERANCE_FRACTION * wanted,
      `the speed a rock at rest in the ${name} corner gains over one tick, ` +
        `which specs/gravity.md fixes at MU / d^2 over TICK_DT for the DIRECT ` +
        `distance d = ${distance.toFixed(1)} across the field, ` +
        `= ${wanted.toFixed(5)} units per second`,
    );

    const toTheStar = directSeparation(posed, STAR);
    const wantedHeading = Math.atan2(toTheStar.y, toTheStar.x);
    assertLessThanOrEqual(
      angleBetween(headingOf(rock), wantedHeading) / DEG,
      HEADING_TOLERANCE / DEG,
      `the heading of the velocity a rock at rest in the ${name} corner gains ` +
        `over one tick, in degrees from the heading across the field to the ` +
        `star's centre (${STAR.x}, ${STAR.y}), which is ` +
        `${(wantedHeading / DEG).toFixed(2)}; a build pulling it toward the ` +
        "nearest wrapped image of the star instead pulls it out through the " +
        "corner, 180 degrees away (specs/gravity.md, specs/field.md)",
    );
  },
);
