// star-core/ship-keeps-its-facing — the core moves the ship, and never turns it.
//
// THE RULE. `specs/collision.md`, "The slide along the core", step 3: on contact
// "THE SHIP'S FACING IS UNCHANGED, and the player keeps full control
// throughout". `specs/ship.md` says the same thing from the other side: the
// facing is turned by a held turn key at `SHIP_TURN` and by nothing else. This
// item is that one sentence. What the contact does to the position is
// `ship-slides-along-the-core`'s and what it does to the velocity is the two
// component items'.
//
// WHAT IS READ. The facing on the tick the contact resolved, against the facing
// the ship was posed with. No turn key is held over the approach, so a build
// that obeys step 3 reports the posed angle to floating point.
//
// WHY THE POSED FACING IS `FACE_UP` AND NOT THE COURSE. Because the three
// plausible ways to get this wrong are all "the ship ends up pointing at
// something", and the check can only tell them apart if the facing it posed
// points at none of them. The approach travels on `-21` degrees, the contact
// normal stands at `116` and the surface tangent at `26`; the ship is posed
// facing `-90`, which is `69`, `154` and `116` degrees from those three. So a
// build that swings the nose onto its heading, one that turns it to face away
// from the core, and one that aligns it with the slide each read a different
// number, and every one of them is more than a hundred times the bound.
//
// WHY A TEN-THOUSANDTH OF A RADIAN. The rule allows no change at all, so the
// bound is not a share of a figure but float slack: nothing in the contact
// touches the angle, so a conformant build reports the number it was handed and
// the only thing between the two readings is the rounding of an angle carried
// through a snapshot. Six thousandths of a degree is far above that rounding and
// far below the smallest turn the game itself can make, which is one tick of
// `SHIP_TURN` (`300` degrees a second) — `2.5` degrees, four hundred times this.
// It is the figure every engine's copy of this item uses.
//
// THE SHIP IS ALONE, AND NO KEY IS HELD. `startPlaying` empties the field, shuts
// both world gates and leaves every key up, so nothing in the game has any
// business touching the facing over the second and a bit this runs.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { DEG, angleBetween } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { GRAZE_FACING, grazeTheCore, showTheContact } from "./approach";

/**
 * How far the facing may have moved, in radians: a ten-thousandth.
 *
 * `specs/collision.md` leaves the facing UNCHANGED through the slide, so the
 * specification's answer is exactly the angle the ship struck with and this is
 * float slack rather than an allowance — nothing in the contact touches the angle,
 * so a conformant build reports the number it was handed. It is six thousandths of
 * a degree, and the same figure decides the item under every engine.
 */
const FACING_TOLERANCE = 1e-4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship's facing exactly as it was through the contact", async () => {
  startPlaying(h);

  const graze = await grazeTheCore(h);
  const facing = graze.path[graze.contact].angle;

  // The ship on the core, still facing where it was.
  await showTheContact(h, graze);
  captureStill(h, "facing");

  assertLessThanOrEqual(
    angleBetween(facing, GRAZE_FACING) / DEG,
    FACING_TOLERANCE / DEG,
    "the ship's facing to be unchanged by the contact with the core " +
      "(specs/collision.md, the slide, step 3), in degrees from the " +
      `${(GRAZE_FACING / DEG).toFixed(0)} degrees it was posed facing and ` +
      "held with no turn key down; it reports " +
      `${(facing / DEG).toFixed(2)} degrees`,
  );
});
