// flight/thrust-along-facing — the thrust acceleration lies along the facing, and
// nowhere else.
//
// THE RULE. `specs/ship.md`: "While the thrust key is held, an acceleration of
// `SHIP_THRUST` (`480` units per second squared) is added along the current
// facing." From rest, with nothing else acting, every tick adds a vector along
// that one bearing and the drag scales the whole velocity by one number, so the
// velocity a burn builds points exactly along the facing however long it runs.
// One degree is what the item allows, and it is generous against that arithmetic:
// a conformant build's error here is float rounding, not a fraction of a degree.
//
// WHY THESE FOUR FACINGS. `30`, `120`, `210` and `300` degrees: one to a quadrant,
// none on an axis, and none an odd multiple of `45`. That placement is what makes
// a failure name the wrong model rather than merely report one. A build that took
// its sine for its cosine thrusts along `90 - theta`, which is a different bearing
// at each of the four but the SAME bearing at `45`; a build that flipped the sign
// of one component thrusts along `-theta` or `180 - theta`, which an axis-aligned
// facing would hide on one axis and expose on the other; a build shoving the ship
// in one fixed screen direction is wrong at three of the four whichever direction
// it picked. At these four every one of those models reads as a different number
// at every sample.
//
// THE GUARD, AND WHY IT IS NOT A SECOND REQUIREMENT. A velocity of zero has no
// bearing to compare, so each burn is confirmed to have produced one before its
// direction is read. How MUCH speed a burn builds is `flight/thrust-accelerates`,
// and nothing here asserts it: the guard is `> 0` and no more, so a build that
// accelerates in the right direction at the wrong rate passes this item and fails
// that one.
//
// THE POSE IS `flight/thrust-accelerates`'s: an emptied field with both world
// gates shut, and a start far below the star, where the well never pulls the ship
// (`specs/gravity.md`) and the half-second burn — about 60 units — never carries
// it within `CORE_R + SHIP_R` (`44`) of the star's centre, where
// `specs/collision.md` would slide it off the core. Every facing is flown from
// the same place at rest, so the four readings differ in nothing but the bearing
// the item is about.

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual, fail } from "../assert";
import { angleGap, headingOf, speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  keyFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { holdFor } from "./drive";

/** The four facings the burn is taken at, in degrees. See the header. */
const FACINGS_DEG = [30, 120, 210, 300] as const;

/** The burn each facing is measured over: half a second, about 60 units travelled. */
const BURN_TICKS = ticksFor(0.5);

/** The one degree the item allows, in radians. */
const BEARING_TOLERANCE = 1 * DEG;

/** Where every burn starts: far below the star, clear of its core all the way out. */
const START = { x: 200, y: 600 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the velocity along the facing at each of four facings", async () => {
  startPlaying(h);

  for (const deg of FACINGS_DEG) {
    const facing = deg * DEG;
    const at = `facing ${String(deg)} degrees`;

    // Back to rest, in the same place, pointing the next way. The pose is the
    // whole difference between one sample and the next.
    h.debug.setShipPosition(START.x, START.y);
    h.debug.setShipVelocity(0, 0);
    h.debug.setShipAngle(facing);

    await holdFor(h, keyFor("up"), BURN_TICKS);
    const burned = h.snapshot();
    // Overwritten each time round, so the picture kept is the last facing that
    // RAN — including the one an assertion below is about to fail on.
    captureStill(h, "facings");

    assertGreaterThan(
      speedOf(burned.ship),
      0,
      `${at}: the speed half a second of held thrust built, which a bearing is ` +
        "taken from — thrust adds an acceleration along the facing " +
        "(specs/ship.md)",
    );
    const bearing = headingOf(burned.ship);
    if (bearing === null) {
      fail(
        `${at}: a velocity with a bearing after half a second of thrust`,
        burned.ship,
      );
    }
    assertLessThanOrEqual(
      angleGap(bearing, facing),
      BEARING_TOLERANCE,
      `${at}: how far the bearing of the velocity the burn built sits from the ` +
        "facing it was taken at, in radians — the acceleration is added along " +
        "the current facing (specs/ship.md)",
    );
  }
});
