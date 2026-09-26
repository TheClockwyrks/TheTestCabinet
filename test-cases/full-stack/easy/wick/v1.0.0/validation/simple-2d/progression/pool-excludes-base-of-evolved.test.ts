// progression/pool-excludes-base-of-evolved — the base weapon of a held evolved
// weapon is not offered back as a new item.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: the new
// weapons are, "when a weapon slot is free, every base weapon not held whose
// evolution is not held", and "An evolved weapon is never a candidate, and
// neither is the base weapon it came from." specs/evolutions.md, What an
// evolution is: "The base weapon it replaced is gone from the loadout, and
// while the evolved weapon is held that base weapon is not a level-up candidate
// either." Pyre's base is Taper by the EVOLUTIONS table.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off. Pyre alone is placed through setWeapon, so Taper is not held and five
// weapon slots stay free: the new-item rule is live, and every other base
// weapon is a candidate, which is what makes Taper's absence the recipe rule
// and not a full loadout.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertNotContains } from "../assert";
import { EVOLUTIONS } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Taper, the base Pyre came from, by the EVOLUTIONS table. */
const BASE = EVOLUTIONS.pyre.from;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves taper out of the pool with Pyre held and a weapon slot free", async () => {
  isolate(h);
  holdWeapon(h, "pyre", 1);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "base");

  assertEqual(overlay.screen, "levelup", "the overlay the pool is read from");
  assertEqual(overlay.run.weapons.length, 1, "one weapon slot of six filled");
  assertContains(
    overlay.run.pool,
    "ember",
    "a base weapon the free slot does offer",
  );
  assertNotContains(
    overlay.run.pool,
    BASE,
    "Taper left out while Pyre is held",
  );
});
