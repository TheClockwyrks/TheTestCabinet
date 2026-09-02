// gravity/direct-not-wrapped — the well reaches a corner across the whole field.
//
// `specs/gravity.md` and `specs/field.md` both state it: "The pull uses the
// body's direct vector to (STAR_X, STAR_Y), not a wrapped one, so a body near a
// corner is pulled by its full distance across the field rather than by the
// distance to a wrapped image of the star." That is the one distance in the whole
// specification measured directly; every other separation is the shortest wrapped
// one `specs/field.md` defines.
//
// WHAT THIS ITEM CAN AND CANNOT SEPARATE — read this before tightening anything.
// `specs/field.md` fixes the star at (640, 360), which is the field's EXACT
// centre, and fixes the shortest wrapped separation as each axis's difference
// brought into [-size/2, +size/2). Every position strictly inside the field is
// therefore within 640 of the star in x and within 360 in y, so its shortest
// wrapped separation to the star IS its direct one, componentwise. No interior
// pose can tell a build that wrapped the vector from one that did not, and this
// check does not pretend to. What it decides is the half of the item that is
// observable, and that half is worth having on its own:
//
//   - THE WELL REACHES THAT FAR AT ALL, and pulls the rock ACROSS the field
//     toward the centre rather than off the near edge. The bearing is read to a
//     degree, so a pull sent anywhere but at (STAR_X, STAR_Y) fails.
//   - AND ITS STRENGTH IS THE ONE THE FULL DIRECT DISTANCE FIXES. The corner is
//     680 units out, where `MU / d^2` is 9.73 — a hundredth of the pull at the
//     distances `gravity/pull-magnitude` samples. A build that applies the well
//     only within some radius of the star, that clamps the distance it divides
//     by, or that carries the softening cap out past `SOFTEN` reads a different
//     number here and passes every other item in this group.
//
// WHY ONE TICK FROM REST, as everywhere in this group: `specs/simulation.md`'s
// tick order leaves a body posed at rest holding exactly `aMag * TICK_DT` after
// one tick, so the reading is the acceleration rather than a path.
//
// WHY A ROCK. The review item names one, and `specs/gravity.md` lists a rock of
// any size among the pulled bodies. A Small is used because it is the smallest
// thing that can sit 40 units inside a corner with its whole circle clear of
// everything, and because `specs/rocks.md` gives a rock's size no part in the
// pull: the well acts on every rock alike.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, MU, SOFTEN, TICK_DT } from "../constants";
import { assertBetween, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  type Harness,
} from "../harness";
import { STAR, angleGap, directDistanceToStar } from "../geometry";
import {
  bearingOf,
  gainAtRest,
  magnitude,
  subtract,
  velocityOf,
  type Point,
} from "./law";

/** How far inside the corner the rock is posed, as the review item states. */
const INSET = 40;

/** The top-left corner, `INSET` units in on both axes: 680 units from the star. */
const CORNER: Point = { x: INSET, y: INSET };

/**
 * How far the gained velocity may point off the star's centre: one degree.
 *
 * The direction the law names is exact and the arithmetic that produces it is
 * exact, so this is rounding room. It is a fiftieth of the 51 degrees a build
 * that pulled along the nearer axis alone would be out by here, and a hundred and
 * eightieth of what a build pulling off the near edge would be.
 */
const BEARING_TOLERANCE = 1 * DEG;

/**
 * The relative tolerance on the strength: five percent, the band this group's
 * other magnitude readings use.
 *
 * The arithmetic is exact; five percent is rounding room on a figure of 0.081
 * units per second. It is nowhere near wide enough to reach what a build that
 * carried the softening cap all the way out here would give, which is 57 times
 * larger, nor to reach the zero of a well that stops short of the corner.
 */
const MAGNITUDE_TOLERANCE = 0.05;

/** The direct distance from the corner to the star: the one the law divides by. */
const DIRECT_DISTANCE = directDistanceToStar(CORNER);

/** What one tick of the pull at that distance gives a rock posed at rest. */
const EXPECTED_GAIN = gainAtRest(CORNER);

/** What one tick of the softening cap, carried out this far, would give instead. */
const CAPPED_GAIN = (MU / (SOFTEN * SOFTEN)) * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pulls a rock in the corner at the star's centre, at its full direct distance", async () => {
  startPlaying(h);
  const id = poseRock(h, "small", CORNER.x, CORNER.y);

  await h.advance(1);
  captureStill(h, "corner");

  const gained = velocityOf(
    rockById(
      h.snapshot(),
      id,
      `a rock at rest ${INSET} units inside the corner`,
    ),
  );

  assertLessThanOrEqual(
    angleGap(bearingOf(gained), bearingOf(subtract(STAR, CORNER))),
    BEARING_TOLERANCE,
    `radians between the velocity gained over one tick and the star's centre, ` +
      `across the field (specs/gravity.md)`,
  );
  assertBetween(
    magnitude(gained),
    EXPECTED_GAIN * (1 - MAGNITUDE_TOLERANCE),
    EXPECTED_GAIN * (1 + MAGNITUDE_TOLERANCE),
    `the speed gained over one tick at the direct distance ` +
      `${DIRECT_DISTANCE}: MU / d^2 x TICK_DT (specs/gravity.md), not the ` +
      `${CAPPED_GAIN.toFixed(4)} a softening cap carried out this far would give`,
  );
});
