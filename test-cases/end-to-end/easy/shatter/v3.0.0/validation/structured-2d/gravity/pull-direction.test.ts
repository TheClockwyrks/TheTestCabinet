// gravity/pull-direction — the pull points at the star's centre, from every
// bearing.
//
// THE RULE. `specs/gravity.md`, "The law": the acceleration is `aMag` "directed
// along the unit vector from the body to the star's centre". This item is that
// direction and nothing else — how hard the well pulls is
// `gravity/pull-magnitude`'s, and a build can fail one without failing the other.
//
// WHAT IS READ. The DIRECTION of the velocity a round posed at rest gains over
// exactly one tick, held against the direction from where it was posed to
// `(STAR_X, STAR_Y)`. `well.ts` explains why the reading is taken from a body at
// rest over one tick; the short of it is that the whole velocity read back is the
// well's contribution, so the heading of the gain IS the heading of the pull.
//
// WHY FOUR BEARINGS, AND WHY THESE FOUR. One bearing cannot separate a pull
// toward the star from a pull along a fixed direction, and one QUADRANT cannot
// separate the pull from a build that got a sign wrong on one axis. Four bearings
// spread one to a quadrant catch both: a build that pulls everything downward
// reads right at one bearing and 90 or 180 degrees out at the others, and a build
// whose `y` term is negated is exactly right on the two bearings level with the
// star and reflected on the rest.
//
// The four are `25`, `115`, `205` and `295` degrees. None is on an axis and none
// is on a diagonal, which is what catches the two cheap approximations a build
// might reach for: a pull snapped to the nearest axis reads 25 degrees out at
// every one of them, and a pull snapped to the nearest diagonal reads 20 degrees
// out at every one of them. Both are twenty times the bound.
//
// WHY ONE DEGREE. The figure the review item states. A body at rest reads the law
// with no integrator between it and the answer, so a build that takes the unit
// vector from the body to `(STAR_X, STAR_Y)` lands on the bearing to floating
// point; one degree is what a build that rounds its star's centre to a whole unit
// or normalizes in single precision can spend, and it is a fortieth of the
// nearest wrong model's error.
//
// ALL FOUR ARE AT 150 UNITS, outside `SOFTEN` (`90`). The cap changes the
// magnitude and not the direction, so nothing about this item turns on it — but
// posing outside it keeps this check reading one rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  DEG,
  STAR,
  angleBetween,
  directSeparation,
  headingOf,
} from "../geometry";
import { aroundTheStar, gainsAtRest } from "./well";

/** How far from the star every round is posed, in units: outside `SOFTEN`. */
const DISTANCE = 150;

/** One bearing per quadrant, none on an axis and none on a diagonal. */
const BEARINGS: readonly number[] = [25 * DEG, 115 * DEG, 205 * DEG, 295 * DEG];

/**
 * How far the gained velocity's heading may fall from the heading to the star's
 * centre, in radians.
 *
 * One degree, the figure the review item states. See the header: a conformant
 * build lands on the bearing to floating point, and the nearest wrong model is
 * twenty degrees out.
 */
const HEADING_TOLERANCE = 1 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pulls toward the star's centre from all four quadrants", async () => {
  startPlaying(h);

  const at = BEARINGS.map((bearing) => aroundTheStar(DISTANCE, bearing));
  const gained = await gainsAtRest(h, at);

  // The four bearings the pull was sampled from, on the tick it was sampled on.
  captureStill(h, "bearings");

  for (let i = 0; i < BEARINGS.length; i += 1) {
    const posed = at[i];
    // specs/gravity.md's own vector: from the body to (STAR_X, STAR_Y), direct.
    const toTheStar = directSeparation(posed, STAR);
    const wanted = Math.atan2(toTheStar.y, toTheStar.x);
    const got = headingOf(gained[i]);

    assertLessThanOrEqual(
      angleBetween(got, wanted) / DEG,
      HEADING_TOLERANCE / DEG,
      `the heading of the velocity a body at rest at ` +
        `(${posed.x.toFixed(2)}, ${posed.y.toFixed(2)}) gains over one tick, ` +
        `in degrees from the heading to the star's centre ` +
        `(${STAR.x}, ${STAR.y}), which is ${(wanted / DEG).toFixed(2)} ` +
        `(specs/gravity.md); it gained ${(got / DEG).toFixed(2)}`,
    );
  }
});
