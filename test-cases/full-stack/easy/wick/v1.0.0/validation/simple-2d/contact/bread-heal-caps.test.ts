// Wick — contact/bread-heal-caps: bread collected at hp 90 leaves hp at exactly maxHp.
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
//
// The other heals are `contact/lamp-oil-heal-caps`, `contact/chest-heal-caps`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";

/** The hp each heal starts from: 10 below the cap, 20 short of the heal. */
const POSED_HP = 90;

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
  captureStill(h, "capped");

  assertEqual(after.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertDeepEqual(after.run.pickups, [], "the bread was collected");
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp after the bread's heal");
});
