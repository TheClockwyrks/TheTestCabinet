// progression/pool-new-weapons-with-free-slot — while a weapon slot is free,
// every base weapon not held is a candidate.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: the pool
// holds, "when a weapon slot is free, every base weapon not held whose
// evolution is not held, each as a new item", and "The base weapons are the ten
// in BASE_WEAPON_IDS". With Taper alone held no evolution is held, so the other
// nine are all candidates. Slots gives WEAPON_SLOTS (6), so one weapon held
// leaves five free.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off. Taper alone is placed at level 1 through setWeapon; no passive and no
// evolved weapon is held, so no other rule can remove a base weapon from the
// pool. The overlay is opened the real way, by queueing a level-up and running
// the playing tick that ends with it queued, and the pool is read off it.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { BASE_WEAPON_IDS } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The one weapon held, so the other nine are the ones not held. */
const HELD = "taper";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the other nine base weapons in the pool with Taper alone held", async () => {
  isolate(h);
  holdWeapon(h, HELD, 1);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "new");

  assertEqual(overlay.screen, "levelup", "the overlay the pool is read from");
  assertEqual(overlay.run.weapons.length, 1, "the one weapon slot filled");
  for (const id of BASE_WEAPON_IDS) {
    if (id === HELD) continue;
    assertContains(overlay.run.pool, id, `${id} offered as a new weapon`);
  }
});
