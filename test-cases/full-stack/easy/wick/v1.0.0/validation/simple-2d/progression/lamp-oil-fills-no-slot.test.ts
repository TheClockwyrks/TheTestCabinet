// progression/lamp-oil-fills-no-slot — accepting lamp oil leaves the weapon and
// passive slots exactly as they were.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The draw: "When the pool is
// empty the overlay offers exactly one item, LAMP_OIL_ID, which fills no slot."
// Choosing's table gives lamp oil one effect and no other: "lamp-oil | hp rises
// by LAMP_OIL_HEAL, capped at maxHp", against the two rows above it that place
// an item in a slot or raise its level. specs/evolutions.md, What an evolution
// is, and specs/progression.md, Slots, make the slots the only place a weapon
// or passive is held, so reading them before and after is the whole of the
// question.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, posed to an empty pool so that lamp oil is the offer: every weapon slot
// holds a base weapon at MAX_WEAPON_LEVEL (8) and every passive slot a passive
// at its PASSIVES max. None of the six weapons carries an aura or a lantern
// set, so the placement part of phase 5 of specs/world.md creates nothing, and
// with weaponFire off no timer counts, so the slots as the overlay opened are
// the slots the acceptance is measured against. No tick runs between the two
// readings: choose is a pose, and "The simulation does not tick while it is
// open" (specs/progression.md).
//
// THE TOLERANCE. None: the two lists are compared whole, id, level, and
// cooldown together.

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

it("reads the same weapons and passives after lamp oil as before it", async () => {
  isolate(h);
  for (const id of FULL_WEAPONS) holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of FULL_PASSIVES) holdPassive(h, id, PASSIVES[id].maxLevel);

  const overlay = await openLevelUp(h, 1);
  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offer is accepted on",
  );
  assertDeepEqual(overlay.run.offers, [LAMP_OIL_ID], "the fallback offer");
  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "slots");

  assertDeepEqual(
    after.run.weapons,
    overlay.run.weapons,
    "the weapon slots across the lamp-oil acceptance",
  );
  assertDeepEqual(
    after.run.passives,
    overlay.run.passives,
    "the passive slots across the lamp-oil acceptance",
  );
});
