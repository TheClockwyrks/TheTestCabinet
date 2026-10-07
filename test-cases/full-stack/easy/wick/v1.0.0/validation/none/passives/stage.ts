// passives/stage — what the passives checks share: the volley several weapons
// fire on one tick, the shapes a tick created, the ticks a weapon fired on, and
// the distance a lantern rides at.
//
// WHY A VOLLEY. Every derived stat of `specs/passives.md` is "a single term in
// exactly one of the formulas", and several of the formulas are read by more
// than one weapon on the same firing tick: `areaMul` scales a bolt's radius and
// a dart's, `amountBonus` raises every amount at once. The harness's
// `fireWeapon` holds and arms ONE weapon; {@link fireVolley} is the same
// arrangement for several, and it is the same arrangement the specification
// describes: `specs/weapons.md` ("Cooldown timers") "On acquisition the timer is
// `0`, so a weapon fires on the first `playing` tick it is held", and every held
// weapon's timer counts on the same tick under phase 5 of `specs/world.md`.
//
// WHY A FAR TARGET. Ember, Beacon, Sconce, and Spark "need a target"
// (`specs/weapons.md`, "Targeting summary"), so a check about a figure of one of
// their shapes has to pose an enemy for them to aim at. {@link FAR} (`5000`) is
// where that enemy stands: `effectMotion` is off on an isolated night, so
// nothing travels at all, and even with it on the longest-lived projectile in
// the specification covers `speed × duration` (`700 × 1.5`, `1050` units at
// most) before its `ttl` is due, so the target is never reached, never hit, and
// never killed. It stands outside `SPARK_RANGE` (`600`) too, so a Spark held
// beside another weapon does not fire at it.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual } from "../assert";
import { type EnemyId, type WeaponId } from "../constants";
import {
  armWeapon,
  distanceBetween,
  enable,
  holdWeapon,
  newProjectiles,
  newZones,
  placeEnemy,
  type EnemyView,
  type Harness,
  type ProjectileView,
  type WickSnapshot,
  type ZoneView,
} from "../harness";

/** How far out an enemy a targeting weapon needs stands, well past every reach. */
export const FAR = 5000;

/** One weapon a volley holds: its id and the level it is held at. */
export interface Held {
  id: WeaponId;
  level: number;
}

/** What one volley tick produced, beside the snapshots either side of it. */
export interface Volley {
  /** The slot each weapon went into, by id. */
  slots: Map<WeaponId, number>;
  /** The state before the volley tick, with every weapon held and due. */
  before: WickSnapshot;
  /** The state the volley tick left. */
  after: WickSnapshot;
  /** The projectiles that tick created, in id order. */
  projectiles: ProjectileView[];
  /** The zones that tick created, in id order. */
  zones: ZoneView[];
}

/**
 * Hold every weapon in `held` at its level, due at once, turn `weaponFire` on,
 * and run the one tick they all fire on.
 *
 * `weaponFire` stays on afterwards, exactly as the harness's `fireWeapon`
 * leaves it, so a check that wants one volley alone turns it back off.
 */
export async function fireVolley(
  h: Harness,
  held: readonly Held[],
): Promise<Volley> {
  const slots = new Map<WeaponId, number>();
  for (const weapon of held) {
    slots.set(weapon.id, await holdWeapon(h, weapon.id, weapon.level));
  }
  for (const slot of slots.values()) await armWeapon(h, slot);
  await enable(h, "weaponFire");
  const before = await h.snapshot();
  const after = await h.step(1);
  return {
    slots,
    before,
    after,
    projectiles: newProjectiles(before, after),
    zones: newZones(before, after),
  };
}

/** The projectiles of `weapon` a volley created, in id order. */
export function shotsOf(volley: Volley, weapon: WeaponId): ProjectileView[] {
  return volley.projectiles.filter((shape) => shape.weapon === weapon);
}

/** The zones of `weapon` a volley created, in id order. */
export function shapesOf(volley: Volley, weapon: WeaponId): ZoneView[] {
  return volley.zones.filter((zone) => zone.weapon === weapon);
}

/** The timer the volley's firing left on `weapon`'s slot, or the point fails. */
export function timerOf(volley: Volley, weapon: WeaponId): number {
  const slot = volley.slots.get(weapon);
  const held = volley.after.run.weapons?.[slot ?? -1];
  assertEqual(held?.id, weapon, `the weapon in the slot ${weapon} fired from`);
  return held?.cooldown ?? NaN;
}

/** Place one enemy of `type` {@link FAR} units along `+x` from the origin. */
export function placeFarTarget(h: Harness, type: EnemyId): Promise<EnemyView> {
  return placeEnemy(h, type, FAR, 0);
}

/**
 * The 1-based ticks of `history` on which a projectile or zone of `weapon` the
 * run had not held before appeared: the ticks the weapon fired on.
 */
export function firedOn(
  before: WickSnapshot,
  history: readonly WickSnapshot[],
  weapon: WeaponId,
): number[] {
  const seen = new Set<number>();
  const record = (snapshot: WickSnapshot): number[] => {
    const ids: number[] = [];
    for (const shape of snapshot.run.projectiles ?? []) {
      if (shape.weapon === weapon) ids.push(shape.id);
    }
    for (const zone of snapshot.run.zones ?? []) {
      if (zone.weapon === weapon) ids.push(zone.id);
    }
    return ids;
  };
  for (const id of record(before)) seen.add(id);
  const fired: number[] = [];
  for (const [index, snapshot] of history.entries()) {
    const fresh = record(snapshot).filter((id) => !seen.has(id));
    if (fresh.length > 0) fired.push(index + 1);
    for (const id of fresh) seen.add(id);
  }
  return fired;
}

/**
 * The 1-based ticks of `history` on which the enemy `id`'s `hp` fell from the
 * tick before, reading `before` as the tick before the first.
 *
 * The reading a re-hit or pulse cadence is decided by: on a night where nothing
 * heals an enemy, the ticks its `hp` fell on are the ticks a shape hit it on.
 */
export function ticksEnemyHpFell(
  before: WickSnapshot,
  history: readonly WickSnapshot[],
  id: number,
): number[] {
  const hpOf = (snapshot: WickSnapshot): number | undefined =>
    (snapshot.run.enemies ?? []).find((enemy) => enemy.id === id)?.hp;
  const fell: number[] = [];
  let previous = hpOf(before) ?? NaN;
  for (const [index, snapshot] of history.entries()) {
    const hp = hpOf(snapshot);
    if (hp !== undefined && hp < previous) fell.push(index + 1);
    if (hp !== undefined) previous = hp;
  }
  return fell;
}

/** The radius of the circle `zone` rides on: its distance from the lamplighter. */
export function orbitOf(snapshot: WickSnapshot, zone: ZoneView): number {
  return distanceBetween(snapshot.run.player, zone);
}
