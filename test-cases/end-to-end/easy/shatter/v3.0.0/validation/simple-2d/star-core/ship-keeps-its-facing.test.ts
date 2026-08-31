// star-core/ship-keeps-its-facing — the contact leaves the facing alone.
//
// `specs/collision.md` step 3 of the slide: "The ship's facing is unchanged, and
// the player keeps full control throughout." This item is the first clause. It is
// its own point because the facing and the velocity are independent in this game —
// `specs/ship.md` gives the ship a facing it turns with a key and a velocity it
// carries, and `specs/instrumentation.md` says `setShipAngle` "changes no velocity"
// — so a build that resolved the contact by turning the ship to face along the
// surface, or out from the core, would slide correctly and still be wrong here.
//
// THE POSED FACING IS DELIBERATELY UNRELATED TO EVERY DIRECTION THE CONTACT
// OFFERS. The ship is driven along the field's `x` axis, facing `35` degrees. The
// travel is `0`, the outward normal at the contact is about `207`, the surface
// tangent about `-63`, and the facing a fresh life takes is `FACE_UP`, `-90`
// (`specs/ship.md`): the posed angle is at least `27` degrees from each of them, so
// a build that snapped the facing to any one of the four fails by a margin no
// tolerance could hide.
//
// NO KEY IS HELD FOR THE WHOLE DRIVE, so `specs/ship.md`'s rotation — the only rule
// in the game that changes a facing — never runs, and the only event that could
// move it is the one this item is about.
//
// THE COMPARISON IS AN ANGULAR GAP rather than a difference of two numbers, so a
// build that reports its facing wrapped into a different turn — `-90` degrees as
// `270` — is not failed for arithmetic the specification does not fix.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { angleGap, degrees, radians } from "../geometry";
import { contactOf, driveIntoTheCore, poseGrazingApproach } from "./strike";

/** How long the ship is driven: three quarters of a second, as its sibling items. */
const DRIVE_TICKS = ticksFor(0.75);

/** The facing the ship is posed with, in radians: `35` degrees. */
const POSED_FACING = radians(35);

/**
 * How far the facing may have moved, in radians: a thousandth.
 *
 * `specs/collision.md` leaves the facing unchanged, so the specification's answer
 * is exactly the angle it was posed with and this is rounding room rather than an
 * allowance. It is six hundredths of a degree, against the `27` degrees that
 * separate the posed facing from the nearest direction a wrong build would snap it
 * to.
 */
const FACING_TOLERANCE = 0.001;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship pointing where it was when it struck the core", async () => {
  startPlaying(h);
  poseGrazingApproach(h);
  h.debug.setShipAngle(POSED_FACING);

  const drive = await driveIntoTheCore(h, DRIVE_TICKS);
  const contact = contactOf(drive);
  captureStill(h, "facing");

  assertLessThanOrEqual(
    angleGap(contact.at.ship.angle, POSED_FACING),
    FACING_TOLERANCE,
    `radians between the ship's facing on the tick it struck the core and ` +
      `the ${degrees(POSED_FACING)} degrees it was posed with ` +
      "(specs/collision.md: the ship's facing is unchanged)",
  );
});
