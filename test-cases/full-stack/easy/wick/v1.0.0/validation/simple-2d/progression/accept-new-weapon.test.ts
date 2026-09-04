// progression/accept-new-weapon — a weapon not held enters the first free
// weapon slot at level 1 with its timer at 0.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Choosing: "A weapon or passive
// not held | It enters the first free slot of its kind at level 1. A weapon's
// cooldown timer starts at 0, so it fires on the first playing tick it is
// held." Slots: "An item enters the first free slot of its kind at level 1 and
// keeps that slot for the rest of the run, so slot order is acquisition order."
// specs/weapons.md, Cooldown timers, says the same of the timer: "On
// acquisition the timer is 0".
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, Taper alone held at level 1, so the first free weapon slot is the second
// one. Ember is put in front of the overlay through setNextOffers, whose list
// "is accepted when every id is a candidate of the pool at that moment"
// (specs/instrumentation.md): with a weapon slot free and no evolution held,
// Ember is a new-item candidate by specs/progression.md, The candidate pool.
// The overlay is opened the real way, and choose(0) accepts the single offer.
//
// THE TOLERANCE. FIGURE_TOLERANCE on the timer, a real number the spec states
// exactly (0); the slot, the id, and the level are discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  present,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts Ember in the second slot at level 1 with cooldown 0", async () => {
  isolate(h);
  holdWeapon(h, "taper", 1);
  h.debug.setNextOffers(["ember"]);

  const overlay = await openLevelUp(h, 1);
  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offer is accepted on",
  );
  assertDeepEqual(
    overlay.run.offers,
    ["ember"],
    "the offer put in front of it",
  );
  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "weapon");

  assertEqual(after.run.weapons.length, 2, "the weapon slots filled");
  assertEqual(after.run.weapons[0]?.id, "taper", "the slot Taper keeps");
  const ember = present(after.run.weapons[1], "the accepted Ember");
  assertEqual(ember.id, "ember", "the weapon in the first free slot");
  assertEqual(ember.level, 1, "the level a new weapon enters at");
  assertWithin(ember.cooldown, 0, FIGURE_TOLERANCE, "its timer on acquisition");
});
