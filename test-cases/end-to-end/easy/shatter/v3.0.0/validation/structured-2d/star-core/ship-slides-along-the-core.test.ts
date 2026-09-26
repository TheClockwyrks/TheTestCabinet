// star-core/ship-slides-along-the-core — the core holds the ship off at exactly
// its own surface.
//
// THE RULE. `specs/collision.md`, "The slide along the core", step 1: on contact
// "the ship's centre is pushed back out along the direction from the star's
// centre to the ship, to a distance of `CORE_R + SHIP_R` (`44`) from
// `(STAR_X, STAR_Y)`". This item is that distance and nothing else. What becomes
// of the velocity is `ship-keeps-its-tangential-speed`'s and
// `ship-loses-its-inward-speed`'s, the facing is `ship-keeps-its-facing`'s, and
// that the contact is free is `core-costs-no-life`'s.
//
// WHAT IS READ. The CLOSEST the ship's centre ever came to the star's centre
// over a graze that would otherwise have passed `GRAZE_MISS` (`30`) units from
// it — see `approach.ts`. That single number is the whole item. A build that
// obeys step 1 can never read below `44`, because every tick that would have put
// the ship inside ends with it back on the surface; and it cannot read above
// `44` either, because the posed course carries it well inside and something has
// to stop it. So `44` is reached from both sides and the reading is exact rather
// than bounded.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build with no boundary at all
// flies straight through and reads `30`, fourteen units under. A build that
// pushes the ship out to the CORE's radius, forgetting that the ship is a circle
// too, reads `30` as well — the same fourteen — and a build that pushes to
// `CORE_R + SHIP_R` measured from the core's SURFACE rather than from the star's
// centre reads `74`, thirty over. A build that stops the ship dead wherever it
// first overlapped, without pushing it out, reads somewhere under `44` by up to
// the `2.5` units a tick of this approach covers. All four are outside the bound.
//
// WHY ONE UNIT. The figure the review item states. The rule fixes a distance
// exactly, and a conforming build lands on it to floating point: the push is a
// single multiplication of a unit vector by `44`, and the reference reads
// `44.0000`. One unit is two fifths of a tick's travel at this speed, so it also
// covers a build that resolves the contact from its end-of-tick position rather
// than from the swept path and so ends a fraction outside the surface.
//
// THE SHIP IS ALONE. `startPlaying` empties the field and shuts both world
// gates, so the only body the ship can meet over the second and a bit this runs
// is the core. The lethal contact gate is left where that helper leaves it —
// off — because it is not this item's requirement and `specs/instrumentation.md`
// is explicit that it does not gate the slide either way.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { GRAZE_MISS, SURFACE, grazeTheCore, type Graze } from "./approach";

/**
 * How far the closest approach may fall from `CORE_R + SHIP_R`, in units.
 *
 * One unit, the figure the review item states. See the header: the rule fixes
 * the distance exactly and the nearest wrong model is fourteen units away.
 */
const STANDOFF_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the ship at CORE_R + SHIP_R from the star's centre", async () => {
  startPlaying(h);

  // The whole graze, not just the frame of the contact: the approach, the
  // deflection, and the ship carrying on around the core and away.
  const graze: Graze = await captureReplay(h, "slide", () => grazeTheCore(h));

  const closest = graze.range[graze.contact];

  assertLessThanOrEqual(
    Math.abs(closest - SURFACE),
    STANDOFF_TOLERANCE,
    `the closest the ship's centre came to the star's centre to be ` +
      `CORE_R + SHIP_R (${SURFACE}), within ${STANDOFF_TOLERANCE} unit — the ` +
      "standoff specs/collision.md's slide pushes it out to — over an " +
      `approach whose undeflected line would have passed ${GRAZE_MISS} units ` +
      `from the centre; it came within ${closest.toFixed(3)}`,
  );
});
