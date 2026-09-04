// gravity/pull-direction — the pull points at the star's centre.
//
// `specs/gravity.md` fixes the direction as well as the magnitude: the
// acceleration is "directed along the unit vector from the body to the star's
// centre". This item reads that direction alone, and nothing about how strong the
// pull is — `gravity/pull-magnitude` owns the strength, so a build that pulls
// hard in the wrong direction and a build that pulls gently in the right one fail
// different items.
//
// WHY ONE TICK FROM REST. Under the tick order `specs/simulation.md` fixes —
// control forces, then the gravity acceleration, then velocity, then position —
// a body posed AT REST holds after one tick exactly the velocity the pull gave
// it, so the BEARING of that velocity is the bearing of the acceleration itself.
// Read over a flight instead, the bearing would be the average of the pull over a
// path the pull was bending, which is a weaker reading of a stated direction.
//
// WHY FOUR OBLIQUE BEARINGS. Two wrong models survive a sample taken on an axis
// and are caught off one. A build that pulls along whichever axis the star is
// further away on, and a build that pulls along the nearer one, both agree with
// the law wherever the body sits due north, south, east or west of the star; at
// 30 degrees off they are 30 and 60 degrees out. So the four samples sit at 30,
// 120, 210 and 300 degrees — one in each quadrant, none on an axis, and none of
// them the negation of another's expected answer, so a build that pulls AWAY from
// the star misses all four rather than passing two.
//
// AND WHY THE BEARING IS TAKEN DIRECTLY. `specs/gravity.md` states that the pull
// uses the body's DIRECT vector to (STAR_X, STAR_Y) rather than a wrapped one, so
// the expected bearing here is computed on the direct vector. At 200 units from
// the middle of the field the two agree anyway; `gravity/direct-not-wrapped` is
// the item that poses where the distinction is the point.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { DEG, STAR_X, STAR_Y } from "../constants";
import {
  captureStill,
  createHarness,
  poseBullet,
  requireBullet,
  startPlaying,
  velocityOf,
  type Harness,
} from "../harness";
import {
  add,
  angleBetween,
  bearingOf,
  scale,
  subtract,
  unitAt,
  type Vec,
} from "../geometry";

/**
 * The four bearings the pull is sampled from, one per quadrant and none on an axis.
 *
 * The distance is the same for all four and does no work here: 200 units is
 * outside `SOFTEN` (90) so the pull is the uncapped one, and far outside
 * `CORE_R + BULLET_R` (33) so no sample is near being absorbed. Four bullets is
 * exactly `MAX_BULLETS`, so nothing about the gun's on-screen limit is in play.
 */
const BEARINGS = [30, 120, 210, 300] as const;

/** How far from the star's centre each sample is posed. */
const SAMPLE_DISTANCE = 200;

/**
 * How far the gained velocity may point off the star's centre: one degree, as the
 * review item states.
 *
 * The law names an exact direction and the arithmetic that produces it is exact,
 * so a degree is rounding room rather than a real allowance. It is a small
 * fraction of what any of the wrong models above is out by.
 */
const BEARING_TOLERANCE = 1 * DEG;

/** The star's centre, which every sample's pull should point at. */
const STAR: Vec = { x: STAR_X, y: STAR_Y };

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("points the velocity a body at rest gains at the star's centre, from every bearing", async () => {
  await startPlaying(harness);

  const placed: { bearing: number; at: Vec; id: number }[] = [];
  for (const degrees of BEARINGS) {
    const at = add(STAR, scale(unitAt(degrees * DEG), SAMPLE_DISTANCE));
    placed.push({
      bearing: degrees,
      at,
      id: await poseBullet(harness, at.x, at.y, 0, 0),
    });
  }

  await harness.advance(1);
  await captureStill(harness, "bearings");

  const snapshot = await harness.snapshot();
  for (const { bearing, at, id } of placed) {
    const gained = velocityOf(
      requireBullet(
        snapshot,
        id,
        `a bullet at rest on the ${bearing} degree bearing`,
      ),
    );
    // The direct vector from where the bullet was posed to the star's centre.
    const wanted = bearingOf(subtract(STAR, at));
    assertLessThanOrEqual(
      angleBetween(bearingOf(gained), wanted),
      BEARING_TOLERANCE,
      `the ${bearing} degree bearing: radians between the gained velocity and the star's centre`,
    );
  }
});
