// contact/chest-heal-caps — a chest's heal at hp 90 leaves hp at exactly maxHp.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Health and recovery"):
// "Every heal from any source, bread, lamp-oil, a chest, or a weapon, adds to
// `hp` and caps it at the `maxHp` in force when the heal is applied." Each of
// the three heals this point drives is fixed with its own figure and its own
// cap:
//   - bread: "Heals `BREAD_HEAL` (`30`), capped at `maxHp`" (specs/world.md —
//     "Pickups");
//   - lamp oil: "`hp` rises by `LAMP_OIL_HEAL`, capped at `maxHp`"
//     (specs/progression.md — "Choosing"), `LAMP_OIL_HEAL` 30;
//   - a chest: "Heal. `hp` rises by `CHEST_HEAL` (`30`), capped at `maxHp`"
//     (specs/evolutions.md — "Opening a chest").
// With `maxHp` 100 (no Tallow held) and `hp` posed to 90, each would reach 120
// uncapped and reads exactly 100 capped.
//
// THE LOADOUT, AND WHY IT IS FULL. Lamp oil is offered only over an empty pool
// ("When the pool is empty the overlay offers exactly one item, `LAMP_OIL_ID`",
// specs/progression.md — "The draw"), and a chest heals only when nothing
// evolves and nothing can be leveled (rules 1 and 2 of "Opening a chest"). Both
// hold at once when every one of the twelve slots is full and every item is at
// its max, with no evolution recipe complete: the four weapons with no
// evolution (Spark, Shard, Sconce, Flare) plus Pin and Ember at `MAX_WEAPON_LEVEL`,
// and six passives at their max that include neither Pin's Mirror nor Ember's
// Oil, nor Tallow (which would move `maxHp`) nor Tinder (which would move `hp`
// on every tick). `weaponFire` is off, so nothing fires, and none of the six
// places an aura or a lantern.
//
// THE DRIVE. An isolated night with every faculty held and that loadout posed.
// Bread first: `hp` to 90, a bread at the lamplighter's center, and the tick
// that collects it (phase 8 of specs/world.md — "One tick"; the collection
// distance is `PICKUP_ITEM_RADIUS` plus `PLAYER_RADIUS`, and the pickup is AT
// the center). Then lamp oil: `hp` back to 90, one level-up queued, the tick
// that opens the overlay, and `choose` on the offer that is `lamp-oil`. Then
// the chest: `hp` back to 90, a chest at the center, and the tick that
// collects it, which opens the chest overlay with the heal.
//
// THE TOLERANCE. `FLOAT_TOL` on each reading: a `min` against `maxHp` is exact.
// An uncapped heal reads 120, twenty away.
//
// The other heals are `contact/bread-heal-caps`, `contact/lamp-oil-heal-caps`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  FLOAT_TOL,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  maxHpOf,
  type BaseWeaponId,
  type PassiveId,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  player,
  type Harness,
} from "../harness";

/** Six base weapons with no recipe that the passives below complete. */
const WEAPONS: readonly BaseWeaponId[] = [
  "spark",
  "shard",
  "sconce",
  "flare",
  "pin",
  "ember",
];

/** Six passives, none Pin's Mirror, Ember's Oil, Tallow, or Tinder. */
const PASSIVE_SET: readonly PassiveId[] = [
  "wick",
  "glass",
  "brass",
  "bellows",
  "soot",
  "lure",
];

/** `maxHp` with no Tallow held: 100. */
const MAX_HP = maxHpOf({});

/** The health the heal starts from: 10 short of the cap, against a heal of 30. */
const POSED_HP = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves hp at exactly 100 after a chest heal from 90", async () => {
  await isolate(h);
  for (const id of WEAPONS) await holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of PASSIVE_SET) await holdPassive(h, id, PASSIVES[id].maxLevel);
  await h.debug.setHp(POSED_HP);

  const chested = await openChest(h);
  await captureStill(h, "capped");

  assertNear(
    player(chested).hp,
    MAX_HP,
    FLOAT_TOL,
    "hp after a chest heal at hp 90 with maxHp 100",
  );
});
