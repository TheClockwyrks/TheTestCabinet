// flight/thrust-along-facing — the thrust acceleration lies along the facing, and
// nowhere else.
//
// THE RULE. `specs/ship.md`: "While the thrust key is held, an acceleration of
// `SHIP_THRUST` (`480` units per second squared) is added along the current
// facing." From rest, with nothing else acting, every tick adds a vector along
// that one bearing and the drag scales the whole velocity by one number, so the
// velocity a burn builds points exactly along the facing however long it runs.
// One degree is what the item allows, and it is generous against the arithmetic:
// a conformant build's error here is float rounding, not a fraction of a degree.
//
// WHY THESE FOUR FACINGS. `30`, `120`, `210` and `300` degrees: one to a
// quadrant, none on an axis, and none an odd multiple of `45`. That placement is
// what makes a failure name the wrong model rather than merely report one. A
// build that took its sine for its cosine thrusts along `90 - theta`, which is a
// different bearing at each of the four but the SAME bearing at `45`; a build
// that flipped the sign of one component thrusts along `-theta` or `180 - theta`,
// which an axis-aligned facing would hide on one axis and expose on the other.
// At these four every one of those models reads as a different number at every
// sample.
//
// THE GUARD, AND WHY IT IS NOT A SECOND REQUIREMENT. A velocity of zero has no
// bearing to compare, so the burn is confirmed to have produced one before its
// direction is read. How MUCH speed a second of thrust builds is
// `flight/thrust-accelerates`, and nothing here asserts it.
//
// The pose is `flight/thrust-accelerates`'s: an emptied, gated field, and a start
// far from the star, where the well does not pull the ship (`specs/gravity.md`)
// and the half-second burn never carries it within `CORE_R + SHIP_R` of the
// star's centre, where `specs/collision.md` would slide it off the core.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { DEG, KEYS_THRUST } from "../constants";
import { bearingOf, angleBetween, magnitude } from "../geometry";
import {
  captureStill,
  createHarness,
  shipVelocity,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The four facings the burn is taken at, in degrees. See the header. */
const FACINGS_DEG = [30, 120, 210, 300] as const;

/** The burn each facing is measured over: half a second, about 60 units travelled. */
const BURN_TICKS = ticksFor(0.5);

/** The one degree the item allows, in radians. */
const BEARING_TOLERANCE = 1 * DEG;

/** Where each burn starts: far below the star, clear of its core all the way out. */
const START = { x: 200, y: 600 };

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves the velocity along the facing at each of four facings", async () => {
  await startPlaying(harness);

  for (const degrees of FACINGS_DEG) {
    const facing = degrees * DEG;
    const at = `facing ${degrees} degrees`;

    // Back to rest, at the same place, pointing the next way.
    await harness.debug.setShipPosition(START.x, START.y);
    await harness.debug.setShipVelocity(0, 0);
    await harness.debug.setShipAngle(facing);

    await harness.holdFor(KEYS_THRUST[0], BURN_TICKS);
    const burned = shipVelocity(await harness.snapshot());
    // Overwritten each time round, so the picture kept is the last facing that
    // RAN — including the one an assertion below is about to fail on.
    await captureStill(harness, "facings");

    assertGreaterThan(
      magnitude(burned),
      0,
      `${at}: the burn built a velocity to take a bearing of`,
    );
    assertLessThanOrEqual(
      angleBetween(bearingOf(burned), facing),
      BEARING_TOLERANCE,
      `${at}: the velocity's bearing away from the facing, in radians`,
    );
  }
});
