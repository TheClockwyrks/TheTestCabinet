// progression/accept-level-rises — accepting a held item's offer raises that
// item's level by one.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Choosing: "A held weapon or
// passive | Its level rises by 1." The candidate pool holds "every held base
// weapon below MAX_WEAPON_LEVEL ... each as a +1 level offer", and Taper at 3
// is below MAX_WEAPON_LEVEL (8).
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, Taper alone held at level 3 through setWeapon. Taper is put in front of
// the overlay through setNextOffers, whose list "is accepted when every id is a
// candidate of the pool at that moment" (specs/instrumentation.md), which Taper
// at 3 is. The overlay is opened the real way, by queueing one level-up and
// running the playing tick that ends with it queued, and choose(0) accepts the
// single offer.
//
// THE TOLERANCE. None: a level is a whole count. A build that re-adds the item
// at level 1, or leaves it where it stood, reads 1 or 3.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  present,
  type Harness,
} from "../harness";

/** Taper's level before the offer: below MAX_WEAPON_LEVEL, so a candidate. */
const HELD_LEVEL = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads Taper at level 4 after accepting its offer at level 3", async () => {
  isolate(h);
  holdWeapon(h, "taper", HELD_LEVEL);
  h.debug.setNextOffers(["taper"]);

  const overlay = await openLevelUp(h, 1);
  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offer is accepted on",
  );
  assertDeepEqual(
    overlay.run.offers,
    ["taper"],
    "the offer put in front of it",
  );
  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "level");

  assertEqual(after.run.weapons.length, 1, "the one weapon slot held");
  const taper = present(after.run.weapons[0], "the leveled Taper");
  assertEqual(taper.id, "taper", "the weapon that kept the slot");
  assertEqual(taper.level, HELD_LEVEL + 1, "the level after the acceptance");
});
