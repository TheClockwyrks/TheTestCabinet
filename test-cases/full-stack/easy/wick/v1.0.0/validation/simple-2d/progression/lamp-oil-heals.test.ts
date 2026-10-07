// progression/lamp-oil-heals — accepting the lamp-oil offer restores
// LAMP_OIL_HEAL health.
//
// THE FIGURE, FROM THE SPEC. specs/progression.md, Choosing, gives the effect
// of the lamp-oil offer: "hp rises by LAMP_OIL_HEAL, capped at maxHp", with
// LAMP_OIL_HEAL (30) in The draw's table. specs/world.md, Health and recovery:
// "Every heal from any source, bread, lamp-oil, a chest, or a weapon, adds to
// hp and caps it at the maxHp in force when the heal is applied." From hp 50
// under BASE_MAX_HP (100) the cap is far off, so the reading is 50 + 30 = 80.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, posed to an empty pool so that lamp oil is the offer: every weapon slot
// holds a base weapon at MAX_WEAPON_LEVEL (8) and every passive slot a passive
// at its PASSIVES max, which is what leaves the pool with nothing to give
// (specs/progression.md, The candidate pool). None of the six passives is
// Tallow, so maxHp stays BASE_MAX_HP and the heal is nowhere near its cap; none
// of the six weapons carries an aura or a lantern set, so the placement part of
// phase 5 of specs/world.md creates nothing. hp is posed to 50 through setHp,
// the overlay is opened the real way, and choose(0) accepts the one offer
// "exactly as moving the highlight there and pressing confirm would"
// (specs/instrumentation.md).
//
// THE TOLERANCE. FIGURE_TOLERANCE on hp, a real number the spec states exactly
// (50 + 30 = 80). A build that ignores the heal reads 50, and one that fills to
// the cap reads 100.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  FIGURE_TOLERANCE,
  LAMP_OIL_HEAL,
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

/** The health posed: far enough below BASE_MAX_HP for the whole heal to land. */
const POSED_HP = 50;

/** Six base weapons at MAX_WEAPON_LEVEL, filling every weapon slot. */
const FULL_WEAPONS: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "spark",
  "shard",
  "sconce",
];

/** Six passives at their max, filling every passive slot; none is Tallow. */
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

it("reads hp 80 after accepting lamp-oil at hp 50", async () => {
  isolate(h);
  for (const id of FULL_WEAPONS) holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of FULL_PASSIVES) holdPassive(h, id, PASSIVES[id].maxLevel);
  h.debug.setHp(POSED_HP);

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
  captureStill(h, "healed");

  assertEqual(after.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertWithin(
    after.run.player.hp,
    POSED_HP + LAMP_OIL_HEAL,
    FIGURE_TOLERANCE,
    "hp after the lamp-oil heal",
  );
});
