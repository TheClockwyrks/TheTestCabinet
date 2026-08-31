// Wick — the weapons' figures and the shapes they make (specs/weapons.md,
// specs/evolutions.md).
//
// The table row a weapon reads at a level, the derived figures a shape takes
// when it is created, and the projectile and puddle factories the debug
// surface and the firing share. The firing and the placement of the
// permanent shapes are phase 5 of the tick.

import {
  BASE_WEAPON_IDS,
  BLAZE_PULSE,
  EVOLUTIONS,
  EVOLUTION_IDS,
  EVOLUTION_STATS,
  LANTERN_REHIT,
  MIN_COOLDOWN,
  OIL_PULSE,
  SCONCE_DECEL,
  SCONCE_REHIT,
  SHARD_REHIT,
  WEAPON_LEVELS,
  type BaseWeaponId,
  type EvolutionId,
  type WeaponId,
  type WeaponRow,
} from "../constants";
import type { Projectile, RunState, Zone } from "../state";
import { areaMul, cooldownMul, damageMul } from "../stats";
import type { TickContext } from "./context";
import { unit } from "./geometry";

export function isBaseWeapon(id: string): id is BaseWeaponId {
  return (BASE_WEAPON_IDS as readonly string[]).includes(id);
}

export function isEvolution(id: string): id is EvolutionId {
  return (EVOLUTION_IDS as readonly string[]).includes(id);
}

export function isWeaponId(id: string): id is WeaponId {
  return isBaseWeapon(id) || isEvolution(id);
}

/** The evolved form of a base weapon. */
export function evolutionOf(base: BaseWeaponId): EvolutionId {
  return EVOLUTION_IDS.find((id) => EVOLUTIONS[id].from === base)!;
}

/** The base weapon an evolved one came from. */
export function baseOf(evolved: EvolutionId): BaseWeaponId {
  return EVOLUTIONS[evolved].from;
}

/** The weapons `id` cannot share a loadout with: itself and its pair. */
export function pairedIds(id: WeaponId): readonly WeaponId[] {
  return isBaseWeapon(id) ? [id, evolutionOf(id)] : [id, baseOf(id)];
}

/** The row `id` reads at `level`; an evolved weapon's fixed row. */
export function rowFor(id: WeaponId, level: number): WeaponRow {
  if (isEvolution(id)) return EVOLUTION_STATS[id];
  return WEAPON_LEVELS[id][level - 1];
}

/** The level at which `id` is held, or `1` when it is not. */
export function heldLevel(run: RunState, id: WeaponId): number {
  const held = run.weapons.find((weapon) => weapon.id === id);
  return held ? held.level : 1;
}

/** The current cooldown of a row: table cooldown scaled, floored. */
export function currentCooldown(run: RunState, row: WeaponRow): number {
  return Math.max(
    MIN_COOLDOWN,
    (row.cooldown ?? 0) * cooldownMul(run.passives),
  );
}

/** The re-hit interval of a projectile or lantern of `weapon`. */
export function rehitInterval(weapon: WeaponId): number {
  switch (weapon) {
    case "lantern":
    case "chandelier":
      return LANTERN_REHIT;
    case "shard":
      return SHARD_REHIT;
    case "sconce":
      return SCONCE_REHIT;
    default:
      return 0;
  }
}

/** The pulse interval of a puddle of `weapon`. */
export function pulseInterval(weapon: WeaponId): number {
  return weapon === "blaze" ? BLAZE_PULSE : OIL_PULSE;
}

export const PROJECTILE_WEAPONS: readonly WeaponId[] = [
  "ember",
  "pin",
  "shard",
  "sconce",
  "beacon",
  "hail",
];

export const PUDDLE_WEAPONS: readonly WeaponId[] = ["oil-splash", "blaze"];

/**
 * One projectile of `weapon`, with the figures the weapon would give a
 * projectile fired on this tick at the level held (or level `1`), scaled by
 * the `areaMul` and `damageMul` in force. A sconce decelerates along its
 * launch direction; every other weapon flies straight.
 */
export function makeProjectile(
  run: RunState,
  weapon: WeaponId,
  x: number,
  y: number,
  vx: number,
  vy: number,
  pierce: number,
): Projectile {
  const row = rowFor(weapon, heldLevel(run, weapon));
  let ax = 0;
  let ay = 0;
  if (weapon === "sconce") {
    const dir = unit({ x: vx, y: vy });
    if (dir === null) throw new Error("a sconce needs a direction to fly");
    // `+ 0` keeps a component along a zero axis at `+0` rather than `-0`.
    ax = -SCONCE_DECEL * dir.x + 0;
    ay = -SCONCE_DECEL * dir.y + 0;
  }
  const projectile: Projectile = {
    id: run.nextId,
    weapon,
    x,
    y,
    vx,
    vy,
    ax,
    ay,
    radius: (row.radius ?? 0) * areaMul(run.passives),
    damage: row.damage * damageMul(run.passives),
    ttl: row.duration ?? 0,
    pierce,
    hits: [],
    bornTick: run.tick,
  };
  run.nextId += 1;
  return projectile;
}

/**
 * One puddle of `weapon` centered at `(x, y)`, with the figures the weapon
 * would give a puddle landing on this tick. It pulses first on the next
 * tick.
 */
export function makePuddle(
  run: RunState,
  weapon: WeaponId,
  x: number,
  y: number,
): Zone {
  const row = rowFor(weapon, heldLevel(run, weapon));
  const zone: Zone = {
    id: run.nextId,
    weapon,
    kind: "puddle",
    x,
    y,
    radius: (row.radius ?? 0) * areaMul(run.passives),
    damage: row.damage * damageMul(run.passives),
    ttl: row.duration ?? 0,
    hits: [],
    bornTick: run.tick,
    pulse: 0,
  };
  run.nextId += 1;
  return zone;
}

/**
 * Phase 5, the firing: while `weaponFire` is on, each held weapon's timer
 * counts down and each weapon whose timer is due fires.
 */
export function fireWeapons(_ctx: TickContext): void {}

/**
 * Phase 5, the placement, on every `playing` tick: an aura or lantern set is
 * created when its weapon is held and none exists, removed when its weapon is
 * no longer held, re-centered about the lamplighter, and resized from the
 * level and multipliers in force.
 */
export function placePermanents(_ctx: TickContext): void {}
