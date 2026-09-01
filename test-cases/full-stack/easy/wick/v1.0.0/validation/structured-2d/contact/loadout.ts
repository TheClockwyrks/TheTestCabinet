// contact/loadout — a loadout with nothing left to offer or to level, shared by
// the heal checks in this directory.
//
// WHY A SHARED LOADOUT. Two of the endings-and-heals points need the game to
// have NOTHING to give but health: the lamp-oil offer comes up only "When the
// pool is empty" (`specs/progression.md`, The draw), and a chest heals only
// when its first two rules find nothing — no base weapon at `MAX_WEAPON_LEVEL`
// whose recipe passive is held, and no "held item below its max level"
// (`specs/evolutions.md`, Opening a chest). Both conditions are met by the
// same arrangement: every one of the `WEAPON_SLOTS` (6) weapon slots holding a
// base weapon at `MAX_WEAPON_LEVEL` (8), every one of the `PASSIVE_SLOTS` (6)
// passive slots holding a passive at its own max, with no free slot of either
// kind, so "when a weapon slot is free" and "when a passive slot is free" add
// nothing to the pool either.
//
// WHICH SIX AND SIX, AND WHY. The checks that use this read `hp` against a
// `maxHp` of exactly `BASE_MAX_HP` (100) and want no heal but the one under
// test, so two passives are left out on purpose: Tallow, which would raise
// `maxHp` (`specs/passives.md`, Max health), and Tinder, whose recovery would
// raise `hp` on its own every tick (Recovery). Of the eight left, the six held
// are chosen so that no held weapon's recipe passive is among them — an
// evolution needs "the first base weapon at `MAX_WEAPON_LEVEL` whose recipe
// passive is held" — and the weapons are chosen so that four of them have no
// evolution at all (Spark, Shard, Sconce, Flare, `specs/evolutions.md`) and the
// other two, Taper and Ember, need Wick and Oil, which are the two of the
// eight not held. No aura or lantern weapon is among them, so nothing is
// placed into the world on the next tick under the placement rule.

import { assertEqual } from "../assert";
import {
  BASE_MAX_HP,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  type BaseWeaponId,
  type PassiveId,
} from "../constants";
import { holdPassive, holdWeapon, type Harness } from "../harness";

/** Six base weapons whose evolutions the held passives cannot trigger. */
export const MAXED_WEAPONS: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "spark",
  "shard",
  "sconce",
  "flare",
];

/** Six passives, none of them Tallow or Tinder, none of them Wick or Oil. */
export const MAXED_PASSIVES: readonly PassiveId[] = [
  "glass",
  "brass",
  "mirror",
  "bellows",
  "soot",
  "lure",
];

/**
 * Fill every weapon slot with a base weapon at `MAX_WEAPON_LEVEL` and every
 * passive slot with a passive at its max, so the level-up pool is empty and a
 * chest has nothing to evolve or level. Reads back that `maxHp` is still
 * `BASE_MAX_HP`, which the arrangement promises by holding no Tallow.
 */
export function holdMaxedLoadout(h: Harness): void {
  for (const id of MAXED_WEAPONS) holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of MAXED_PASSIVES) holdPassive(h, id, PASSIVES[id].maxLevel);
  assertEqual(
    h.snapshot().run.maxHp,
    BASE_MAX_HP,
    "maxHp with no Tallow held (specs/passives.md, Max health)",
  );
}
