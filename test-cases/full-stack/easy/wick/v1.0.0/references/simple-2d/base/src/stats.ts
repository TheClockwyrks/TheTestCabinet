// Wick — the derived stats (specs/passives.md "The derived stats").
//
// Each passive is one term in exactly one formula here, read from the levels
// held at the moment the stat is needed. A passive not held is level `0`.

import {
  BASE_MAX_HP,
  BASE_RECOVERY,
  BELLOWS_SPEED_PER_LEVEL,
  BRASS_ARMOR_PER_LEVEL,
  GLASS_AREA_PER_LEVEL,
  LURE_PICKUP_PER_LEVEL,
  MIRROR_AMOUNT_PER_LEVEL,
  MOVE_SPEED,
  OIL_COOLDOWN_PER_LEVEL,
  PICKUP_RADIUS,
  SOOT_XP_PER_LEVEL,
  TALLOW_HP_PER_LEVEL,
  TINDER_RECOVERY_PER_LEVEL,
  WICK_DAMAGE_PER_LEVEL,
  XP_BASE,
  XP_STEP,
  type PassiveId,
} from "./constants";
import type { PassiveSlot } from "./game";

/** The level of `id` among `passives`, `0` when it is not held. */
export function passiveLevel(
  passives: readonly PassiveSlot[],
  id: PassiveId,
): number {
  const held = passives.find((passive) => passive.id === id);
  return held ? held.level : 0;
}

export function damageMul(passives: readonly PassiveSlot[]): number {
  return 1 + WICK_DAMAGE_PER_LEVEL * passiveLevel(passives, "wick");
}

export function cooldownMul(passives: readonly PassiveSlot[]): number {
  return 1 - OIL_COOLDOWN_PER_LEVEL * passiveLevel(passives, "oil");
}

export function areaMul(passives: readonly PassiveSlot[]): number {
  return 1 + GLASS_AREA_PER_LEVEL * passiveLevel(passives, "glass");
}

export function armor(passives: readonly PassiveSlot[]): number {
  return BRASS_ARMOR_PER_LEVEL * passiveLevel(passives, "brass");
}

export function amountBonus(passives: readonly PassiveSlot[]): number {
  return MIRROR_AMOUNT_PER_LEVEL * passiveLevel(passives, "mirror");
}

export function speedMul(passives: readonly PassiveSlot[]): number {
  return 1 + BELLOWS_SPEED_PER_LEVEL * passiveLevel(passives, "bellows");
}

export function moveSpeed(passives: readonly PassiveSlot[]): number {
  return MOVE_SPEED * speedMul(passives);
}

export function maxHp(passives: readonly PassiveSlot[]): number {
  return BASE_MAX_HP + TALLOW_HP_PER_LEVEL * passiveLevel(passives, "tallow");
}

export function recovery(passives: readonly PassiveSlot[]): number {
  return (
    BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL * passiveLevel(passives, "tinder")
  );
}

export function xpMul(passives: readonly PassiveSlot[]): number {
  return 1 + SOOT_XP_PER_LEVEL * passiveLevel(passives, "soot");
}

export function pickupMul(passives: readonly PassiveSlot[]): number {
  return 1 + LURE_PICKUP_PER_LEVEL * passiveLevel(passives, "lure");
}

export function pickupRadius(passives: readonly PassiveSlot[]): number {
  return PICKUP_RADIUS * pickupMul(passives);
}

/** The experience needed to leave `level`. */
export function xpToNext(level: number): number {
  return XP_BASE + XP_STEP * (level - 1);
}
