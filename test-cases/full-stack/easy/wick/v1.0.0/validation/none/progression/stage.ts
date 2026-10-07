// progression/stage — the loadouts the pool checks in this directory pose.
//
// The candidate pool is computed "from the slots as they stand"
// (specs/progression.md), so a check about a pool poses a loadout and nothing
// else: an isolated night with every faculty held, nothing alive, and the slots
// arranged exactly as the rule under test needs them. Three arrangements are
// shared, because more than one check needs each and a pool that differs by one
// slot between two checks decides two different things.
//
// WHY THESE SIX AND THESE SIX. `WEAPON_SLOTS` and `PASSIVE_SLOTS` are `6` each,
// so a full loadout is six of each; which six is the harness's choice, and the
// six weapons below are the base weapons that place no standing zone, so a tick
// run under a full loadout creates nothing whatever the faculties are. The six
// passives are the ones whose derived stats leave `maxHp`, `xpMul`, and
// `pickupRadius` alone (specs/passives.md), so a check that reads health or a
// gain over a full loadout reads the same figures an empty one gives.

import {
  MAX_WEAPON_LEVEL,
  PASSIVES,
  type BaseWeaponId,
  type PassiveId,
} from "../constants";
import {
  holdPassive,
  holdWeapon,
  isolate,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** Six base weapons, enough to fill `WEAPON_SLOTS`, none of which places a standing zone. */
export const FULL_WEAPONS: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "spark",
  "shard",
  "sconce",
];

/** The four base weapons {@link FULL_WEAPONS} leaves out. */
export const SPARE_WEAPONS: readonly BaseWeaponId[] = [
  "lantern",
  "halo",
  "oil-splash",
  "flare",
];

/** Six passives, enough to fill `PASSIVE_SLOTS`, none of which touches `maxHp`, `xpMul`, or `pickupRadius`. */
export const FULL_PASSIVES: readonly PassiveId[] = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "bellows",
];

/** The four passives {@link FULL_PASSIVES} leaves out. */
export const SPARE_PASSIVES: readonly PassiveId[] = [
  "tallow",
  "tinder",
  "soot",
  "lure",
];

/**
 * Fill every slot with every held item at its max: "every held base weapon
 * below `MAX_WEAPON_LEVEL`, and every held passive below its max level" leaves
 * nothing, and both slot kinds are full, so the pool is empty.
 */
export async function poseEmptyPool(h: Harness): Promise<WickSnapshot> {
  await isolate(h);
  for (const id of FULL_WEAPONS) await holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of FULL_PASSIVES)
    await holdPassive(h, id, PASSIVES[id].maxLevel);
  return h.snapshot();
}

/** The one weapon {@link poseSmallPool} leaves below `MAX_WEAPON_LEVEL`. */
export const SMALL_POOL_WEAPON: BaseWeaponId = "taper";

/** The one passive {@link poseSmallPool} leaves below its max level. */
export const SMALL_POOL_PASSIVE: PassiveId = "bellows";

/**
 * The full loadout of {@link poseEmptyPool} with {@link SMALL_POOL_WEAPON} one
 * level below `MAX_WEAPON_LEVEL` and {@link SMALL_POOL_PASSIVE} one level below
 * its max, so the pool holds exactly those two, in `BASE_WEAPON_IDS` order then
 * `PASSIVE_IDS` order.
 */
export async function poseSmallPool(h: Harness): Promise<WickSnapshot> {
  await isolate(h);
  for (const id of FULL_WEAPONS) {
    const level =
      id === SMALL_POOL_WEAPON ? MAX_WEAPON_LEVEL - 1 : MAX_WEAPON_LEVEL;
    await holdWeapon(h, id, level);
  }
  for (const id of FULL_PASSIVES) {
    const max = PASSIVES[id].maxLevel;
    await holdPassive(h, id, id === SMALL_POOL_PASSIVE ? max - 1 : max);
  }
  return h.snapshot();
}
