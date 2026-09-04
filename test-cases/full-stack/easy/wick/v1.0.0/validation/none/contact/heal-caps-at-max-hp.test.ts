// contact/heal-caps-at-max-hp — every heal caps hp at the maxHp in force.
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

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, fail } from "../assert";
import {
  FLOAT_TOL,
  LAMP_OIL_ID,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  maxHpOf,
  type BaseWeaponId,
  type PassiveId,
} from "../constants";
import {
  captureStill,
  collectPickup,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  openLevelUp,
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

/** The health each heal starts from: 10 short of the cap, against a heal of 30. */
const POSED_HP = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves hp at exactly 100 after bread, lamp oil, and a chest heal from 90", async () => {
  await isolate(h);
  for (const id of WEAPONS) await holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of PASSIVE_SET) await holdPassive(h, id, PASSIVES[id].maxLevel);

  // Bread.
  await h.debug.setHp(POSED_HP);
  const fed = await collectPickup(h, "bread");
  assertNear(
    player(fed).hp,
    MAX_HP,
    FLOAT_TOL,
    "hp after bread collected at hp 90 with maxHp 100",
  );

  // Lamp oil, over the empty pool the full loadout leaves.
  await h.debug.setHp(POSED_HP);
  const opened = await openLevelUp(h);
  const index = (opened.run.offers ?? []).indexOf(LAMP_OIL_ID);
  if (opened.screen !== "levelup" || index < 0) {
    fail(`the levelup overlay offering ${LAMP_OIL_ID} over an empty pool`, {
      screen: opened.screen,
      offers: opened.run.offers,
    });
  }
  await h.debug.choose(index);
  const oiled = await h.snapshot();
  assertNear(
    player(oiled).hp,
    MAX_HP,
    FLOAT_TOL,
    "hp after lamp oil accepted at hp 90 with maxHp 100",
  );

  // A chest, whose result is the heal because nothing can evolve or level.
  await h.debug.setHp(POSED_HP);
  const chested = await openChest(h);

  // The chest overlay reporting its heal, over the HUD at full health.
  // Captured before the assertion, so a failing build leaves the picture that
  // shows why.
  await captureStill(h, "capped");

  assertNear(
    player(chested).hp,
    MAX_HP,
    FLOAT_TOL,
    "hp after a chest heal at hp 90 with maxHp 100",
  );
});
