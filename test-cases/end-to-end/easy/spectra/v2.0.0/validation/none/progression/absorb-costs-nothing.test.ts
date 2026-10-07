// progression/absorb-costs-nothing — a same-band enemy bullet costs no life.
//
// `specs/progression.md` prices it in its table: "An enemy bullet of the ship's
// own band reaches the ship | Nothing, and it is absorbed." `specs/bands.md`
// states the same rule from the other side, as the hull's shield.
//
// SO THIS ITEM IS ABOUT THE PRICE ALONE. Whether the bullet leaves the roster is
// `bands/shield-absorbs`'s, and this check deliberately does NOT require it: the
// sweep below ends either when the hull takes the bullet or when the bullet has
// fallen clear past the lane, so a build that let a same-band bullet through
// without charging for it is graded here on the life it did not take, and on the
// one it did not. Reading the count alone is what keeps the two items able to
// fail separately.
//
// THE CONTACT IS REAL, NOT POSED. Nothing here writes `lives`. One enemy bullet
// carrying the ship's OWN band is placed above the hull and allowed to fall, and
// the build's own contact and band rules decide the rest. `setShipContact(true)`
// puts back the one world gate `startPosed` shuts, because a contact test is
// exactly this item's requirement — with the gate shut, no bullet of any band
// could cost anything and the check would pass on a build that charges for
// everything.
//
// THE FIELD HOLDS NOTHING ELSE, so the only thing that could move the life count
// in this window is the bullet under test.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ENEMY_BULLET_SPEED,
  SHIP_Y,
  START_LIVES,
  bulletSpeedScale,
} from "../constants";
import {
  bulletById,
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/**
 * How far above the ship's centre the bullet starts, in logical units.
 *
 * The hull's contact reach against an enemy bullet is `SHIP_HALF` (`15`) plus
 * `ENEMY_BULLET_HALF` (`8`) — 23 units of centre separation — so 120 starts the
 * bullet better than five times clear of it, and whatever the hull does to it is
 * a consequence of the fall rather than of the placement.
 */
const DROP_ABOVE = 120;

/**
 * How far BELOW the ship's centre the sweep follows a bullet the hull did not
 * take, in logical units.
 *
 * Past the contact reach above (`23`) with room to spare, so a bullet still in
 * flight at this depth has been through the lane and out the other side: either
 * way the ship has had its chance at it, and the life count is the reading.
 */
const PAST_HULL = 30;

/** The speed an enemy bullet falls at on stage 1 (`specs/stages.md`). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given.
 *
 * The time to fall `DROP_ABOVE + PAST_HULL` at `FALL_SPEED` — geometry, not a
 * tolerance — plus two frames for the frame the bullet is placed on. It leaves
 * the bullet no lower than `y = 637`, above `FIELD_BOTTOM` (`656`), so inside
 * this sweep a bullet cannot leave the roster by falling off the field
 * (`specs/field.md`): if it leaves, the hull took it.
 */
const FALL_FRAMES = framesFor((DROP_ABOVE + PAST_HULL) / FALL_SPEED) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the lives unchanged when a same-band bullet reaches the ship", async () => {
  await startPosed(h);
  // The one world gate this item's requirement IS.
  await h.debug.setShipContact(true);
  const posed = await h.snapshot();
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  // The ship's OWN band, read off the ship rather than named, so the check asks
  // its question of whatever band the build opened on.
  const band = posed.ship.band;
  const bullet = await poseEnemyBulletAbove(h, band, DROP_ABOVE);

  const reached = await h.until(
    (s) => {
      const inFlight = bulletById(s, bullet);
      return inFlight === undefined || inFlight.y > SHIP_Y + PAST_HULL;
    },
    { maxFrames: FALL_FRAMES },
  );
  await captureStill(h, "unchanged");

  assertEqual(
    reached.hit,
    true,
    `the ${band} bullet dropped ${String(DROP_ABOVE)} units above the hull ` +
      "reaching the ship's lane — taken by the hull, or past it — inside the " +
      `${String(FALL_FRAMES)} frames its fall takes`,
  );
  assertEqual(
    reached.snapshot.lives,
    START_LIVES,
    "the lives left after an enemy bullet of the ship's OWN band reached the " +
      "ship, which costs nothing (specs/progression.md)",
  );
});
