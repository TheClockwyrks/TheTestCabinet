// progression/lamp-oil-alone-when-empty — an empty pool is answered by one
// offer, LAMP_OIL_ID, and nothing beside it.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The draw: "When the pool is
// empty the overlay offers exactly one item, LAMP_OIL_ID, which fills no slot",
// with LAMP_OIL_ID (lamp-oil) in the table above it.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, posed to an empty pool. The pool empties only when every rule of
// specs/progression.md, The candidate pool, has nothing to give: every weapon
// slot holds a base weapon at MAX_WEAPON_LEVEL (8) and every passive slot a
// passive at its PASSIVES max, so no held item is below a max and neither
// new-item rule applies with the slots full. None of the six weapons carries an
// aura or a lantern set, so the placement part of phase 5 of specs/world.md
// creates nothing. The overlay is opened the real way, by queueing a level-up
// and running the playing tick that ends with it queued.
//
// THE TOLERANCE. None: the pool is empty or it is not, and the offer list is
// one id or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  LAMP_OIL_ID,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  type BaseWeaponId,
  type PassiveId,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Six base weapons at MAX_WEAPON_LEVEL, filling every weapon slot. */
const FULL_WEAPONS: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "spark",
  "shard",
  "sconce",
];

/** Six passives at their max, filling every passive slot. */
const FULL_PASSIVES: readonly PassiveId[] = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "bellows",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("offers lamp-oil alone over an empty pool", async () => {
  isolate(h);
  for (const id of FULL_WEAPONS) holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of FULL_PASSIVES) holdPassive(h, id, PASSIVES[id].maxLevel);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "oil");

  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offers are read from",
  );
  assertDeepEqual(overlay.run.pool, [], "the pool the full loadout leaves");
  assertDeepEqual(overlay.run.offers, [LAMP_OIL_ID], "the fallback offer");
});
