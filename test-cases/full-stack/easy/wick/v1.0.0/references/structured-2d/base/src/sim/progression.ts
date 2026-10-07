// Wick — experience, level-ups, the offers, and the chest's result
// (specs/progression.md, specs/evolutions.md "Opening a chest").

import {
  BASE_WEAPON_IDS,
  CHEST_HEAL,
  CUES,
  LAMP_OIL_HEAL,
  LAMP_OIL_ID,
  MAX_WEAPON_LEVEL,
  OFFER_COUNT,
  PASSIVES,
  PASSIVE_IDS,
  PASSIVE_SLOTS,
  TALLOW_HP_PER_LEVEL,
  WEAPON_SLOTS,
  EVOLUTIONS,
  type CueName,
  type OfferId,
  type PassiveId,
  type WeaponId,
} from "../constants";
import type { Rng } from "../rng";
import type { ChestResult, RunState, WickState } from "../state";
import { passiveLevel, xpToNext } from "../stats";
import type { TickContext } from "./context";
import { heal } from "./lamplighter";
import { evolutionOf, isBaseWeapon, isWeaponId } from "./weapons";

export function isPassiveId(id: string): id is PassiveId {
  return (PASSIVE_IDS as readonly string[]).includes(id);
}

export function isOfferId(id: string): id is OfferId {
  return isWeaponId(id) || isPassiveId(id) || id === LAMP_OIL_ID;
}

/**
 * Add experience and, while `spend` is on, queue every level-up it crosses.
 * `spend` is the `progression` driver switch: with it off `xp` rises and
 * stands however high it climbs, and `level` and `pendingLevelUps` hold.
 */
export function gainXp(run: RunState, amount: number, spend = true): void {
  run.xp += amount;
  if (!spend) return;
  while (run.xp >= xpToNext(run.level)) {
    run.xp -= xpToNext(run.level);
    run.level += 1;
    run.pendingLevelUps += 1;
  }
}

/**
 * The candidate pool, from the slots as they stand: held items below their
 * max as `+1 level` offers, and, where a slot is free, the items not held,
 * in `BASE_WEAPON_IDS` order then `PASSIVE_IDS` order.
 */
export function candidatePool(run: RunState): OfferId[] {
  const pool: OfferId[] = [];
  const heldWeapons = new Set(run.weapons.map((weapon) => weapon.id));
  const weaponSlotFree = run.weapons.length < WEAPON_SLOTS;
  for (const id of BASE_WEAPON_IDS) {
    const held = run.weapons.find((weapon) => weapon.id === id);
    if (held) {
      if (held.level < MAX_WEAPON_LEVEL) pool.push(id);
    } else if (weaponSlotFree) {
      const evolved = evolutionOf(id);
      if (evolved === null || !heldWeapons.has(evolved)) pool.push(id);
    }
  }
  const passiveSlotFree = run.passives.length < PASSIVE_SLOTS;
  for (const id of PASSIVE_IDS) {
    const held = run.passives.find((passive) => passive.id === id);
    if (held) {
      if (held.level < PASSIVES[id].maxLevel) pool.push(id);
    } else if (passiveSlotFree) {
      pool.push(id);
    }
  }
  return pool;
}

/** Whether `ids` may stand in for the draw over `pool`. */
function acceptable(
  ids: readonly OfferId[],
  pool: readonly OfferId[],
): boolean {
  if (pool.length === 0) return ids.length === 1 && ids[0] === LAMP_OIL_ID;
  return ids.every((id) => pool.includes(id));
}

/**
 * Open the level-up overlay: compute the pool, consume `nextOffers` or draw
 * at random, fill `offers`, and enter `levelup`.
 */
export function openLevelUp(
  state: WickState,
  rng: Rng,
  cues: Set<CueName>,
): void {
  const { run } = state;
  const pool = candidatePool(run);
  const queued = run.nextOffers;
  run.nextOffers = null;
  if (queued !== null && acceptable(queued, pool)) {
    run.offers = queued.slice();
  } else if (pool.length === 0) {
    run.offers = [LAMP_OIL_ID];
  } else {
    run.offers = rng.sample(pool, OFFER_COUNT);
  }
  state.screen = "levelup";
  state.menuIndex = 0;
  cues.add(CUES.levelUp);
}

/** Whether `id` is held, so the offer reads as `+1 level`. */
export function isHeld(run: RunState, id: OfferId): boolean {
  if (isWeaponId(id)) return run.weapons.some((weapon) => weapon.id === id);
  if (isPassiveId(id)) return run.passives.some((passive) => passive.id === id);
  return false;
}

/** Raise a held passive's level by one, with Tallow's health on the spot. */
function levelPassive(ctx: TickContext, id: PassiveId): number {
  const held = ctx.run.passives.find((passive) => passive.id === id)!;
  held.level += 1;
  if (id === "tallow") heal(ctx, TALLOW_HP_PER_LEVEL);
  return held.level;
}

/** Raise a held weapon's level by one; its running timer keeps counting. */
function levelWeapon(ctx: TickContext, id: WeaponId): number {
  const held = ctx.run.weapons.find((weapon) => weapon.id === id)!;
  held.level += 1;
  return held.level;
}

/** Apply an accepted offer: a new item, a level, or lamp oil. */
export function applyOffer(ctx: TickContext, id: OfferId): void {
  const { run } = ctx;
  if (id === LAMP_OIL_ID) {
    heal(ctx, LAMP_OIL_HEAL);
  } else if (isWeaponId(id)) {
    if (isHeld(run, id)) levelWeapon(ctx, id);
    else run.weapons.push({ id, level: 1, cooldown: 0, cooldownSet: 0 });
  } else if (isHeld(run, id)) {
    levelPassive(ctx, id);
  } else {
    run.passives.push({ id, level: 1 });
    if (id === "tallow") heal(ctx, TALLOW_HP_PER_LEVEL);
  }
}

/**
 * Accept the offer at `index` on `levelup`: apply it, and either open the
 * next queued overlay or return to `playing`.
 */
export function acceptOffer(ctx: TickContext, index: number): void {
  const { state, run } = ctx;
  const id = run.offers[index];
  applyOffer(ctx, id);
  ctx.cues.add(CUES.choose);
  run.pendingLevelUps = Math.max(0, run.pendingLevelUps - 1);
  run.offers = [];
  if (run.pendingLevelUps > 0) {
    openLevelUp(state, ctx.rng, ctx.cues);
  } else {
    state.screen = "playing";
    state.menuIndex = 0;
  }
}

/** The result of a chest: an evolution, a level, or a heal, in that order. */
export function openChest(ctx: TickContext): ChestResult {
  const { run } = ctx;
  // The posed item is consumed by this chest whatever its result.
  const posed = run.nextChestItem;
  run.nextChestItem = null;
  for (const held of run.weapons) {
    if (!isBaseWeapon(held.id) || held.level < MAX_WEAPON_LEVEL) continue;
    const evolved = evolutionOf(held.id);
    if (evolved === null) continue;
    if (passiveLevel(run.passives, EVOLUTIONS[evolved].passive) === 0) continue;
    held.id = evolved;
    held.level = 1;
    held.cooldown = 0;
    held.cooldownSet = 0;
    ctx.cues.add(CUES.evolve);
    return { kind: "evolve", weapon: evolved };
  }
  const levelable: (WeaponId | PassiveId)[] = [];
  for (const held of run.weapons) {
    if (isBaseWeapon(held.id) && held.level < MAX_WEAPON_LEVEL) {
      levelable.push(held.id);
    }
  }
  for (const held of run.passives) {
    if (held.level < PASSIVES[held.id].maxLevel) levelable.push(held.id);
  }
  if (levelable.length > 0) {
    const item =
      posed !== null && levelable.includes(posed)
        ? posed
        : ctx.rng.pick(levelable);
    const level = isPassiveId(item)
      ? levelPassive(ctx, item)
      : levelWeapon(ctx, item);
    return { kind: "level", item, level };
  }
  heal(ctx, CHEST_HEAL);
  return { kind: "heal" };
}
