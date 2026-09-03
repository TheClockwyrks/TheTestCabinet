// contact/heal-caps-at-max-hp — every heal caps hp at the maxHp in force: bread,
// lamp oil, and a chest's heal each carry hp 90 to exactly 100 with maxHp 100.
//
// THE RULE, FROM THE SPEC. specs/world.md, Health and recovery: "Every heal
// from any source, bread, lamp-oil, a chest, or a weapon, adds to hp and caps
// it at the maxHp in force when the heal is applied." Each heal is 30: bread
// "Heals BREAD_HEAL (30), capped at maxHp" (specs/world.md, Pickups); lamp oil
// "hp rises by LAMP_OIL_HEAL, capped at maxHp" (specs/progression.md,
// Choosing); a chest's heal "hp rises by CHEST_HEAL (30), capped at maxHp"
// (specs/evolutions.md, Opening a chest). From 90 each would reach 120 uncapped
// and reads 100, the BASE_MAX_HP with no Tallow held.
//
// THE THREE SCENARIOS, each an isolated night with hp posed to 90 through setHp:
//
// - Bread: one bread posed at the lamplighter's center, collected on the next
//   tick by specs/world.md's collection rule.
// - Lamp oil: the level-up overlay offers lamp oil only "When the pool is
//   empty" (specs/progression.md, The draw), so every weapon slot holds a base
//   weapon at MAX_WEAPON_LEVEL and every passive slot a passive at its max, none
//   of them Tallow so maxHp stays 100 and none of them Halo, Lantern, or Oil
//   Splash so no placement runs. A queued level-up opens the overlay at the end
//   of the next tick, and choose(0) accepts the one offer.
// - Chest: one chest posed at the lamplighter's center with nothing held, so no
//   weapon can evolve and no item is below its max, and the chest's result is
//   the heal by the third rule of specs/evolutions.md.
//
// THE TOLERANCE. None: a cap at maxHp yields the maxHp value itself, exactly
// 100. A build that skipped a cap reads 120.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  BASE_MAX_HP,
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
  spawnPickupAt,
  type Harness,
} from "../harness";

/** The hp each heal starts from: 10 below the cap, 20 short of the heal. */
const POSED_HP = 90;

/**
 * Six base weapons at MAX_WEAPON_LEVEL, filling every weapon slot: none is a
 * +1 candidate, and no slot is free for a new one. None carries an aura or a
 * lantern set, so the placement part of a tick has nothing to create.
 */
const FULL_WEAPONS: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "spark",
  "shard",
  "sconce",
];

/**
 * Six passives at their max, filling every passive slot: none is a +1
 * candidate, and no slot is free. Tallow is left out so maxHp stays 100.
 */
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

it("caps bread's 30 at maxHp: hp 90 reads exactly 100 after collecting it", async () => {
  isolate(h);
  h.debug.setHp(POSED_HP);
  const { player } = h.snapshot().run;
  spawnPickupAt(h, "bread", player.x, player.y);

  const after = await h.tick(1);

  assertEqual(after.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertDeepEqual(after.run.pickups, [], "the bread was collected");
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp after the bread's heal");
});

it("caps lamp oil's 30 at maxHp: hp 90 reads exactly 100 after accepting it", async () => {
  isolate(h);
  for (const id of FULL_WEAPONS) holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of FULL_PASSIVES) holdPassive(h, id, PASSIVES[id].maxLevel);
  h.debug.setHp(POSED_HP);

  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the overlay opened");
  assertDeepEqual(
    overlay.run.offers,
    [LAMP_OIL_ID],
    "lamp oil alone offered over an empty pool",
  );
  h.debug.choose(0);
  const after = h.snapshot();

  assertEqual(after.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp after lamp oil's heal");
});

it("caps a chest's 30 at maxHp: hp 90 reads exactly 100 after the heal result", async () => {
  isolate(h);
  h.debug.setHp(POSED_HP);
  const { player } = h.snapshot().run;
  spawnPickupAt(h, "chest", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "capped");

  assertEqual(after.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertDeepEqual(
    after.run.chestResult,
    { kind: "heal" },
    "the chest's result with nothing held",
  );
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp after the chest's heal");
});
