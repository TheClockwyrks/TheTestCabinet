// progression/pool-excludes-maxed-weapon — a base weapon held at
// MAX_WEAPON_LEVEL is not a candidate.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: the pool
// holds "every held base weapon below MAX_WEAPON_LEVEL ... each as a +1 level
// offer", and Slots gives MAX_WEAPON_LEVEL (8) as the level "A base weapon
// levels up to". A weapon at 8 is therefore below nothing and is left out. The
// new-item rule cannot put it back: that rule offers "every base weapon not
// held", and Taper is held.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off. Taper alone is placed, at MAX_WEAPON_LEVEL, through setWeapon, whose
// level for a base weapon runs "1 to MAX_WEAPON_LEVEL". Five weapon slots and
// every passive slot are left free, so the pool is far from empty and its
// contents rest on the rules rather than on there being nothing to offer. The
// overlay is opened the real way and the pool read off it.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotContains } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves taper out of the pool with it held at MAX_WEAPON_LEVEL", async () => {
  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "maxed");

  assertEqual(overlay.screen, "levelup", "the overlay the pool is read from");
  assertGreaterThan(
    overlay.run.pool.length,
    0,
    "the pool the overlay computed",
  );
  assertNotContains(
    overlay.run.pool,
    "taper",
    "Taper at 8 left out of the pool",
  );
});
