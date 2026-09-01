// passives/night — what the points of this category share: an isolated night
// holding a named set of passives, the weapons whose figures those passives are
// read through, and the probes those weapons aim at. CASE-PROVIDED.
//
// No review item names this file. Each function is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them.
//
// WHY A PASSIVE IS POSED THROUGH `setPassive`. specs/instrumentation.md
// (`setPassive`): "Puts passive `id` at `level` in `slot` ... `hp` is
// untouched; `maxHp`, `armor`, `moveSpeed`, `pickupRadius`, and every
// multiplier follow from the next read", which is the seam every derived stat
// of specs/passives.md is read across. A level is posed rather than earned, so
// a build with a broken level-up overlay still fails only the progression
// points.

import {
  PASSIVE_IDS,
  type EnemyId,
  type HeldPassives,
  type WeaponId,
} from "../constants";
import {
  armWeapon,
  holdPassive,
  holdWeapon,
  present,
  spawnEnemyNear,
  type GemSnapshot,
  type Harness,
  type Point,
  type WickSnapshot,
  type ZoneSnapshot,
} from "../harness";

/** One weapon a night holds, and the level it is held at. */
export type WeaponAt = readonly [WeaponId, number];

/** The slot each weapon of a night took, by id. */
export type Slots = Partial<Record<WeaponId, number>>;

/**
 * Hold each passive `held` names at its level, one slot each, in the order
 * `PASSIVE_IDS` lists them, so two nights holding the same set pose the same
 * slots. A passive `held` omits stays unheld, which every formula of
 * specs/passives.md reads as level `0`.
 */
export function holdPassives(h: Harness, held: HeldPassives): void {
  for (const id of PASSIVE_IDS) {
    const level = held[id];
    if (level !== undefined) holdPassive(h, id, level);
  }
}

/**
 * Hold each weapon of `weapons` at its level and make every one of them fire on
 * the next `playing` tick: each timer posed to `0` and `weaponFire` on
 * ("`setWeaponCooldown(slot, 0)` makes that the next tick",
 * specs/instrumentation.md). The slots they took, by id.
 */
export function armAll(h: Harness, weapons: readonly WeaponAt[]): Slots {
  const slots: Slots = {};
  for (const [id, level] of weapons) {
    const slot = holdWeapon(h, id, level);
    slots[id] = slot;
    armWeapon(h, slot);
  }
  return slots;
}

/** The slot `id` took, or the point fails because the pose did not take. */
export function slotOf(slots: Slots, id: WeaponId): number {
  return present(slots[id], `the slot ${id} was posed in`);
}

/** The timer the weapon in `slot` carries, or `NaN` when the slot is empty. */
export function timerOf(snapshot: WickSnapshot, slot: number): number {
  return snapshot.run.weapons[slot]?.cooldown ?? Number.NaN;
}

/**
 * Spawn one enemy of `type` at each of `offsets` from the lamplighter's center;
 * their ids, in the order the offsets are given. Every enemy a weapon aims at is
 * posed this way, so a firing reads the distances and directions the point
 * chose.
 */
export function probesAround(
  h: Harness,
  type: EnemyId,
  offsets: readonly Point[],
): number[] {
  return offsets.map((offset) => spawnEnemyNear(h, type, offset.x, offset.y));
}

/** How far `zone`'s center sits from the lamplighter's, the orbit it rides. */
export function orbitOf(snapshot: WickSnapshot, zone: ZoneSnapshot): number {
  const { player } = snapshot.run;
  return Math.hypot(zone.x - player.x, zone.y - player.y);
}

/** The ids of the zones `weapon` has in the world. */
export function zoneIdsOf(snapshot: WickSnapshot, weapon: WeaponId): number[] {
  return snapshot.run.zones
    .filter((zone) => zone.weapon === weapon)
    .map((zone) => zone.id);
}

/** The ids of the projectiles `weapon` has in the world. */
export function projectileIdsOf(
  snapshot: WickSnapshot,
  weapon: WeaponId,
): number[] {
  return snapshot.run.projectiles
    .filter((projectile) => projectile.weapon === weapon)
    .map((projectile) => projectile.id);
}

/**
 * The ticks of `trace`, counted from `1` for its first snapshot, on which a
 * shape carrying an id `seen` did not already hold appeared, `seen` growing as
 * the sweep goes. Each such tick is a firing: "A pose that creates an entity
 * gives it the next id from `nextId`" (specs/instrumentation.md) and
 * specs/state.md has an id "unique for the run", so a fresh id is a shape the
 * tick created.
 */
export function freshTicks(
  trace: readonly WickSnapshot[],
  idsOf: (snapshot: WickSnapshot) => readonly number[],
  seen: Set<number>,
): number[] {
  const ticks: number[] = [];
  trace.forEach((snapshot, index) => {
    const fresh = idsOf(snapshot).filter((id) => !seen.has(id));
    if (fresh.length > 0) ticks.push(index + 1);
    for (const id of fresh) seen.add(id);
  });
  return ticks;
}

/** The gem `id` names in `snapshot`, or the point fails because it is gone. */
export function gemOf(snapshot: WickSnapshot, id: number): GemSnapshot {
  return present(
    snapshot.run.gems.find((gem) => gem.id === id),
    `the gem ${id}`,
  );
}
