// progression/pool-no-new-weapon-when-full — with every weapon slot filled, no
// base weapon that is not held is a candidate.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: the new
// weapons come from the pool only "when a weapon slot is free", so with none
// free the pool holds no base weapon that is not held. Slots gives WEAPON_SLOTS
// (6), and the six held here are all at level 1, below MAX_WEAPON_LEVEL (8), so
// the pool is not empty and its lacking the four is the rule at work rather
// than nothing being offered at all.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off. Six base weapons are placed at level 1 through setWeapon, filling every
// weapon slot; none of them is Halo, Lantern, or Oil Splash, so the placement
// part of phase 5 of specs/world.md creates nothing and the field stays empty.
// Every passive slot is left free, so the passives are candidates and the pool
// is plainly computed. The overlay is opened the real way and the pool read off
// it.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotContains } from "../assert";
import { BASE_WEAPON_IDS, WEAPON_SLOTS, type BaseWeaponId } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/**
 * Six base weapons at level 1, filling every weapon slot. Each is a +1
 * candidate, so the pool is non-empty; none carries an aura or a lantern set,
 * so the placement part of a tick has nothing to create.
 */
const FULL_WEAPONS: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "spark",
  "shard",
  "sconce",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds no base weapon that is not held with all six weapon slots filled", async () => {
  isolate(h);
  for (const id of FULL_WEAPONS) holdWeapon(h, id, 1);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "full");

  assertEqual(overlay.screen, "levelup", "the overlay the pool is read from");
  assertEqual(overlay.run.weapons.length, WEAPON_SLOTS, "every slot filled");
  for (const id of BASE_WEAPON_IDS) {
    if (FULL_WEAPONS.includes(id)) continue;
    assertNotContains(
      overlay.run.pool,
      id,
      `${id} left out with the slots full`,
    );
  }
});
