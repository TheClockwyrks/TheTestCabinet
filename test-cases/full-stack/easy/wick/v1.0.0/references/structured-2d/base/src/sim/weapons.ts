// Wick — the weapons' figures and the shapes they make (specs/weapons.md,
// specs/evolutions.md).
//
// The table row a weapon reads at a level, the derived figures a shape takes
// when it is created, the targeting every weapon shares, and the projectile,
// puddle, and lantern factories the debug surface, the firing, and the
// placement share. The firing itself is `firing.ts` and the placement of the
// permanent shapes is `placement.ts`, the two parts of phase 5 of the tick.

import {
  BASE_WEAPON_IDS,
  BEACON_STATS,
  BLAZE_PULSE,
  BLAZE_STATS,
  CHANDELIER_STATS,
  CORONA_STATS,
  EVOLUTIONS,
  EVOLUTION_IDS,
  HAIL_STATS,
  LANTERN_REHIT,
  MIN_COOLDOWN,
  OIL_PULSE,
  PYRE_STATS,
  SCONCE_DECEL,
  SCONCE_REHIT,
  SHARD_REHIT,
  TAPER_MAX_AMOUNT,
  WEAPON_LEVELS,
  type BaseWeaponId,
  type EvolutionId,
  type WeaponId,
} from "../constants";
import type {
  EnemyState,
  ProjectileState,
  RunState,
  ZoneState,
} from "../state";
import { amountBonus, areaMul, cooldownMul, damageMul } from "../stats";
import { facingVector } from "./enemies";
import { direction, distance, fromDegrees, unit, type Vec } from "./geometry";

/**
 * One row of any weapon's table, or an evolved weapon's fixed row, read
 * through one shape: every weapon carries `damage`, and the rest of a row is
 * what its weapon's shape needs. A figure a weapon has no use for is absent.
 */
export interface WeaponRow {
  readonly damage: number;
  readonly cooldown?: number;
  readonly speed?: number;
  readonly radius?: number;
  readonly pierce?: number;
  readonly duration?: number;
  readonly amount?: number;
  readonly width?: number;
  readonly height?: number;
  readonly orbit?: number;
  readonly area?: number;
}

/** Each evolved weapon's fixed row, by id. Chandelier has no cooldown. */
export const EVOLUTION_STATS: Readonly<Record<EvolutionId, WeaponRow>> = {
  pyre: PYRE_STATS,
  beacon: BEACON_STATS,
  hail: HAIL_STATS,
  chandelier: CHANDELIER_STATS,
  corona: CORONA_STATS,
  blaze: BLAZE_STATS,
};

export function isBaseWeapon(id: string): id is BaseWeaponId {
  return (BASE_WEAPON_IDS as readonly string[]).includes(id);
}

export function isEvolution(id: string): id is EvolutionId {
  return (EVOLUTION_IDS as readonly string[]).includes(id);
}

export function isWeaponId(id: string): id is WeaponId {
  return isBaseWeapon(id) || isEvolution(id);
}

/** The evolved form of a base weapon, or `null` for one with no recipe. */
export function evolutionOf(base: BaseWeaponId): EvolutionId | null {
  return EVOLUTION_IDS.find((id) => EVOLUTIONS[id].from === base) ?? null;
}

/** The base weapon an evolved one came from. */
export function baseOf(evolved: EvolutionId): BaseWeaponId {
  return EVOLUTIONS[evolved].from;
}

/** The weapons `id` cannot share a loadout with: itself and its pair. */
export function pairedIds(id: WeaponId): readonly WeaponId[] {
  if (isEvolution(id)) return [id, baseOf(id)];
  const evolved = evolutionOf(id);
  return evolved === null ? [id] : [id, evolved];
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
): ProjectileState {
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
  const projectile: ProjectileState = {
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
): ZoneState {
  const row = rowFor(weapon, heldLevel(run, weapon));
  const zone: ZoneState = {
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
 * One lantern of `weapon` at `angle` degrees on a circle of radius `orbit`
 * about the lamplighter, a touching zone with `ttl` `null` unless given.
 */
export function makeLantern(
  run: RunState,
  weapon: WeaponId,
  angle: number,
  orbit: number,
  radius: number,
  damage: number,
  ttl: number | null,
): ZoneState {
  const zone: ZoneState = {
    id: run.nextId,
    weapon,
    kind: "lantern",
    x: 0,
    y: 0,
    radius,
    damage,
    ttl,
    hits: [],
    bornTick: run.tick,
    angle,
    orbit,
  };
  run.nextId += 1;
  placeLantern(run, zone);
  return zone;
}

/** Put a lantern on its orbit about the lamplighter's center, at its angle. */
export function placeLantern(run: RunState, lantern: ZoneState): void {
  const dir = fromDegrees(lantern.angle ?? 0);
  const orbit = lantern.orbit ?? 0;
  lantern.x = run.player.x + dir.x * orbit;
  lantern.y = run.player.y + dir.y * orbit;
}

/**
 * The amount a weapon fires with: the row's amount plus `amountBonus`, capped
 * for the two-sided slash of Taper and Pyre.
 */
export function amountOf(run: RunState, id: WeaponId, row: WeaponRow): number {
  const amount = (row.amount ?? 0) + amountBonus(run.passives);
  return id === "taper" || id === "pyre"
    ? Math.min(TAPER_MAX_AMOUNT, amount)
    : amount;
}

/** The live enemies nearest the lamplighter: distance, then lowest id. */
export function nearestEnemies(run: RunState, count: number): EnemyState[] {
  const player = run.player;
  return run.enemies
    .map((enemy) => ({ enemy, gap: distance(player, enemy) }))
    .sort((a, b) => a.gap - b.gap || a.enemy.id - b.enemy.id)
    .slice(0, count)
    .map(({ enemy }) => enemy);
}

/**
 * The unit vector from the lamplighter's center toward `target`, or the
 * facing direction when the two coincide.
 */
export function aimAt(run: RunState, target: Vec): Vec {
  return direction(run.player, target) ?? facingVector(run);
}
