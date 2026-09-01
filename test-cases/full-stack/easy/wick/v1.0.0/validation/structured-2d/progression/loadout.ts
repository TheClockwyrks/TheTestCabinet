// Wick — progression: the slot arrangements several checks in this category
// share. NOT a check: a module of poses, so a check that needs a pool of a
// stated size names the arrangement it means rather than spelling twelve
// `setWeapon` calls of its own.
//
// WHERE THE ARRANGEMENTS COME FROM. `specs/progression.md`, "Slots":
// `WEAPON_SLOTS` (`6`), `PASSIVE_SLOTS` (`6`), `MAX_WEAPON_LEVEL` (`8`), and
// "a passive levels up to its own max level, given in `specs/passives.md`".
// "The candidate pool" holds "every held base weapon below `MAX_WEAPON_LEVEL`,
// and every held passive below its max level"; a new weapon only "when a
// weapon slot is free" and a new passive only "when a passive slot is free".
// So filling both kinds of slot with items at their maximum leaves the pool
// EMPTY, and lowering one item by a level leaves a pool of exactly one.
//
// WHY TALLOW IS LEFT OUT of the six passives: it is the one passive that moves
// a figure another check reads, `+15` max health per level
// (`specs/passives.md`), so the arrangements here leave `maxHp` at
// `BASE_MAX_HP` and a heal check can state its own numbers.

import {
  MAX_WEAPON_LEVEL,
  PASSIVES,
  type BaseWeaponId,
  type PassiveId,
} from "../constants";
import { holdPassive, holdWeapon, type Harness } from "../harness";

/** The six base weapons that fill the weapon slots, in acquisition order. */
export const FILLED_WEAPONS: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "lantern",
  "halo",
  "oil-splash",
];

/** The four base weapons those six leave unheld. */
export const UNHELD_WEAPONS: readonly BaseWeaponId[] = [
  "spark",
  "shard",
  "sconce",
  "flare",
];

/** The six passives that fill the passive slots, in acquisition order. */
export const FILLED_PASSIVES: readonly PassiveId[] = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "bellows",
];

/** The four passives those six leave unheld. */
export const UNHELD_PASSIVES: readonly PassiveId[] = [
  "tallow",
  "tinder",
  "soot",
  "lure",
];

/**
 * Fill all six weapon slots with {@link FILLED_WEAPONS}. Each takes the level
 * `levels` names for it, or `fallback`, which defaults to `MAX_WEAPON_LEVEL`.
 */
export function fillWeapons(
  h: Harness,
  levels: Partial<Record<BaseWeaponId, number>> = {},
  fallback: number = MAX_WEAPON_LEVEL,
): void {
  for (const id of FILLED_WEAPONS) holdWeapon(h, id, levels[id] ?? fallback);
}

/**
 * Fill all six passive slots with {@link FILLED_PASSIVES}. Each takes the level
 * `levels` names for it, or `fallback`, which defaults to that passive's own
 * max level from `PASSIVES`.
 */
export function fillPassives(
  h: Harness,
  levels: Partial<Record<PassiveId, number>> = {},
  fallback: number | null = null,
): void {
  for (const id of FILLED_PASSIVES) {
    holdPassive(h, id, levels[id] ?? fallback ?? PASSIVES[id].maxLevel);
  }
}

/**
 * Every slot filled and every held item at its maximum: the arrangement whose
 * candidate pool is empty.
 */
export function saturate(h: Harness): void {
  fillWeapons(h);
  fillPassives(h);
}
