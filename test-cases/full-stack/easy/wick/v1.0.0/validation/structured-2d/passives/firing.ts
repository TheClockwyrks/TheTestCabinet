// passives/firing — one posed firing under a named set of passives, shared by
// the checks in this directory. CASE-PROVIDED.
//
// WHAT EVERY CHECK HERE SHARES. A passive "changes nothing on its own: each
// one is a single term in exactly one of the formulas" (`specs/passives.md`),
// so a check on a passive holds that passive, holds a weapon, and reads the
// one firing the passive's term reaches. That arrangement is spelled once
// here and decides nothing: `isolate` clears the world, the passives go in
// through `setPassive`, the weapons through `setWeapon`, and the firing
// through `setWeaponCooldown(slot, 0)` with `weaponFire` on
// ("`setWeaponCooldown(slot, 0)` makes that the next tick",
// `specs/instrumentation.md`). What the one real tick created is read back by
// id, telling this tick's shapes from anything posed before it.
//
// EVERY OTHER SWITCH STAYS OFF. `isolate` leaves the six others off, so on
// the firing tick nothing spawns, nothing despawns, no enemy moves or
// touches the lamplighter, and no shape travels: "Every projectile holds its
// position and velocity, and every lantern holds its angle. `ttl` and every
// re-hit entry still count, and hits still resolve"
// (`specs/instrumentation.md`, the `effectMotion` row). A check that is about
// motion turns `effectMotion` back on itself.
//
// WHERE A TARGET STANDS. Ember, Spark, Sconce, and Beacon "need a target"
// (`specs/weapons.md`, Targeting summary), so a check on one of them stands
// an enemy in the world for the weapon to aim at. {@link FAR_POST} is far
// enough that no shape a firing tick creates overlaps an enemy there while
// `effectMotion` is off: the widest is a Flare burst, and Flare is never held
// beside it. {@link RANGE_POST} is inside `SPARK_RANGE` (`600`), for a check
// that needs Spark to have an eligible target, and near enough that a bolt
// reaches it inside its `duration`.

import {
  advanceTicks,
  isolate,
  holdPassive,
  holdWeapon,
  placeEnemyNear,
  projectilesCreatedSince,
  zonesCreatedSince,
  type Harness,
  type Point,
  type SnapshotProjectile,
  type SnapshotZone,
  type WickSnapshot,
} from "../harness";
import type { EnemyId, PassiveId, WeaponId } from "../constants";

/**
 * A post no shape a firing tick creates reaches while `effectMotion` is off:
 * every projectile sits at the lamplighter's center with a radius of at most
 * `12`, the widest puddle lands at most `OIL_SCATTER` (`400`) out with a
 * radius of at most `75`, and a lantern rides an orbit of at most `135`.
 */
export const FAR_POST: Point = { x: 900, y: 0 };

/**
 * A post inside `SPARK_RANGE` (`600`), where an enemy is one of Spark's
 * "eligible targets" (`specs/weapons.md`, Spark) and close enough for a bolt
 * of speed `400` to cross before its `duration` of `2.0` seconds is out.
 */
export const RANGE_POST: Point = { x: 500, y: 0 };

/** One passive held at one level. */
export type HeldPassive = readonly [PassiveId, number];

/**
 * Every passive whose term reaches a weapon's figures at all, each held far
 * from level `1`: Glass 5 (`areaMul` `1.5`), Oil 5 (`cooldownMul` `0.6`),
 * Wick 5 (`damageMul` `1.5`), and Mirror 2 (`amountBonus` `2`)
 * (`specs/passives.md`, The derived stats). What a check on a figure the
 * passives leave as written holds, so a build that fed any of the four into
 * that figure reports a value well away from the written one.
 */
export const SCALERS: readonly HeldPassive[] = [
  ["glass", 5],
  ["oil", 5],
  ["wick", 5],
  ["mirror", 2],
];

/** One weapon held at one level. */
export type HeldWeapon = readonly [WeaponId, number];

/** One enemy standing at an offset from the lamplighter's center. */
export type Post = readonly [EnemyId, Point];

/** What the scenario holds and stands before the firing tick runs. */
export interface Arrangement {
  passives?: readonly HeldPassive[];
  weapons?: readonly HeldWeapon[];
  enemies?: readonly Post[];
}

/** What one posed firing tick left. */
export interface Firing {
  /** The slot each weapon took, in the order they were named. */
  slots: readonly { id: WeaponId; slot: number }[];
  /** The enemies' ids, in the order their posts were given. */
  targets: readonly number[];
  /** The state before the firing tick, with every timer armed. */
  before: WickSnapshot;
  /** The state after the firing tick. */
  after: WickSnapshot;
  /** The projectiles the firing tick created, in id order. */
  projectiles: readonly SnapshotProjectile[];
  /** The zones the firing tick created, in id order. */
  zones: readonly SnapshotZone[];
}

/**
 * Pose an isolated run holding `passives` and `weapons` with an enemy at each
 * of `enemies`, arm every held weapon, run the one tick they fire on, and
 * read what it left.
 */
export async function fireUnder(
  h: Harness,
  arrangement: Arrangement,
): Promise<Firing> {
  isolate(h);
  for (const [id, level] of arrangement.passives ?? []) {
    holdPassive(h, id, level);
  }
  const targets = (arrangement.enemies ?? []).map(([type, at]) =>
    placeEnemyNear(h, type, at.x, at.y),
  );
  const slots = (arrangement.weapons ?? []).map(([id, level]) => ({
    id,
    slot: holdWeapon(h, id, level),
  }));
  for (const { slot } of slots) h.debug.setWeaponCooldown(slot, 0);
  h.debug.setWeaponFire(true);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return {
    slots,
    targets,
    before,
    after,
    projectiles: projectilesCreatedSince(before, after),
    zones: zonesCreatedSince(before, after),
  };
}

/** The slot weapon `id` took in `firing`, or `-1` when it was not held. */
export function slotOf(firing: Firing, id: WeaponId): number {
  return firing.slots.find((held) => held.id === id)?.slot ?? -1;
}

/** The timer weapon `id` carries after the firing tick, in seconds. */
export function timerOf(firing: Firing, id: WeaponId): number {
  const slot = slotOf(firing, id);
  return firing.after.run.weapons[slot]?.cooldown ?? NaN;
}
