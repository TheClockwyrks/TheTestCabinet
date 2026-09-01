// Wick — evolutions/evolved: what the evolution checks share. CASE-PROVIDED.
//
// WHAT EVERY CHECK HERE SHARES. Two arrangements, and nothing else. A recipe
// check poses an isolated run, fills the slots the recipe names, and runs the
// one tick that collects a chest at the lamplighter's center — "The chest
// overlay is reached through `spawnPickup("chest", x, y)` at the lamplighter's
// center and one tick, which is the real collection path"
// (`specs/instrumentation.md`), which the harness spells as `openChest`. An
// evolved-weapon check poses an isolated run, holds the evolved weapon through
// `setWeapon` — "`level` is ... `1` for an evolved one"
// (`specs/instrumentation.md`) — and runs the tick it fires, pulses, or is
// placed on. Neither arrangement decides an outcome: "every hit, kill, drop,
// collection, level-up, evolution, and ending comes from the ticks run after
// the pose".
//
// WHY AN ISOLATED RUN. `isolate` clears every enemy, projectile, zone, gem and
// pickup, removes the fresh run's Taper, and turns every driver switch off, so
// what a check watches is the one behavior it names: no director spawn, no
// scripted event, no despawn, no enemy motion, no contact hit, no other
// weapon firing, and no effect moving unless the check turns that faculty
// back on.
//
// WHERE THE LAMPLIGHTER STANDS FOR A GEOMETRY READING. A fresh run starts it
// at `(0, 0)` (`specs/world.md`, The lamplighter), so a circle laid about the
// world origin and one laid about the lamplighter's center would read the
// same. {@link POSED} is a center that is neither the origin nor on either
// axis, posed through `setPlayerPosition`, which "Sets the lamplighter's
// center to `(x, y)`. Nothing else moves" (`specs/instrumentation.md`).
//
// HOW A HIT IS READ. `specs/weapons.md` ("Hits and death"): "A hit removes the
// shape's damage per hit from the enemy's `hp`", and an enemy at or below `0`
// after the hits "dies on that tick". So an enemy is read as hit when its `hp`
// fell or when it is gone from `enemies`; an enemy nothing reached keeps
// exactly the `hp` it was posed with, since in an isolated run nothing but the
// shape under test can touch it.

import { fail } from "../assert";
import {
  EVOLUTIONS,
  REAL_EPS,
  type EvolutionId,
  type PassiveId,
  type WeaponId,
} from "../constants";
import {
  advanceTicks,
  angleOf,
  armWeapon,
  distance,
  enable,
  enemyById,
  holdPassive,
  holdWeapon,
  isolate,
  projectilesCreatedSince,
  zonesCreatedSince,
  type Harness,
  type Point,
  type SnapshotProjectile,
  type SnapshotZone,
  type WickSnapshot,
} from "../harness";
import type { ChestResult } from "../surface";

/**
 * Where the lamplighter stands for a check that reads a distance or an angle:
 * a center that is neither the origin nor on either axis.
 */
export const POSED: Point = { x: 200, y: -140 };

/** What one posed firing tick left. */
export interface Firing {
  /** The slot the evolved weapon was placed in. */
  slot: number;
  /** The state before the firing tick, with the weapon armed. */
  before: WickSnapshot;
  /** The state after the firing tick. */
  after: WickSnapshot;
  /** The zones that tick created for the weapon, in id order. */
  zones: SnapshotZone[];
  /** The projectiles that tick created for the weapon, in id order. */
  projectiles: SnapshotProjectile[];
}

/**
 * Hold evolved weapon `id` at its single level in the first free weapon slot
 * and make it fire on the next tick: its timer posed to `0` and `weaponFire`
 * on. "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (`specs/instrumentation.md`). The slot it took.
 */
export function armEvolved(h: Harness, id: EvolutionId): number {
  const slot = holdWeapon(h, id, 1);
  armWeapon(h, slot);
  return slot;
}

/**
 * Pose an isolated run, hold evolved weapon `id` armed to fire on the next
 * tick, run that one tick, and read what it left.
 *
 * `isolate` first, so the run holds nothing but the weapon under test: no
 * enemy, no other weapon (the fresh run's Taper removed), no passive, every
 * driver switch off but the `weaponFire` that arming turns on. `at` moves the
 * lamplighter before the firing, for a check that reads a distance or an
 * angle; omitted, the fresh run's origin stands.
 */
export async function fireEvolved(
  h: Harness,
  id: EvolutionId,
  at?: Point,
): Promise<Firing> {
  isolate(h);
  if (at !== undefined) h.debug.setPlayerPosition(at.x, at.y);
  return fireFromPosed(h, id);
}

/**
 * Hold evolved weapon `id` armed in the run AS IT STANDS, run the one tick it
 * fires on, and read what that tick created. For a check that isolates for
 * itself and poses the world the firing lands in before the weapon is held.
 */
export async function fireFromPosed(
  h: Harness,
  id: EvolutionId,
): Promise<Firing> {
  const slot = armEvolved(h, id);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return {
    slot,
    before,
    after,
    zones: zonesCreatedSince(before, after).filter(
      (zone) => zone.weapon === id,
    ),
    projectiles: projectilesCreatedSince(before, after).filter(
      (projectile) => projectile.weapon === id,
    ),
  };
}

/**
 * How far from the lamplighter's center an enemy stands for an aura check:
 * inside Corona's radius of 150 by a wide margin, clear of the lamplighter's
 * own circle, and outside `PICKUP_RADIUS` (`48`), so a gem an enemy drops is
 * never drawn in and nothing but the pulse changes what a check reads.
 */
export const INSIDE = 120;

/**
 * Hold Corona and turn `weaponFire` on, leaving its timer exactly as
 * `setWeapon` left it — "When the slot's `id` changes its cooldown timer
 * becomes `0`" (`specs/instrumentation.md`) — so the tick that follows is the
 * first `playing` tick Corona is held, which is the tick
 * `specs/evolutions.md` ("Corona") says it pulses on. The slot it took.
 */
export function holdCorona(h: Harness): number {
  const slot = holdWeapon(h, "corona", 1);
  enable(h, "weaponFire");
  return slot;
}

/** What the one playing tick that placed a Chandelier set left. */
export interface Placement {
  /** The slot Chandelier was placed in. */
  slot: number;
  /** The state before the placing tick. */
  before: WickSnapshot;
  /** The state after the placing tick. */
  after: WickSnapshot;
  /** The Chandelier lanterns standing after it, in id order. */
  lanterns: SnapshotZone[];
}

/**
 * Pose an isolated run, hold Chandelier, and run the one `playing` tick that
 * places its set.
 *
 * The set arrives through the PLACEMENT part of phase 5, which runs "on every
 * `playing` tick" whatever the driver switches hold
 * (`specs/instrumentation.md`, The driver switches; `specs/world.md`, One
 * tick), so nothing is armed and no switch is turned on: Chandelier is held
 * through `setWeapon` and one tick is run. `at` moves the lamplighter before
 * that tick, for a check that reads a distance or an angle.
 */
export async function placeChandelier(
  h: Harness,
  at?: Point,
): Promise<Placement> {
  isolate(h);
  if (at !== undefined) h.debug.setPlayerPosition(at.x, at.y);
  const slot = holdWeapon(h, "chandelier", 1);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return { slot, before, after, lanterns: chandelierLanterns(after) };
}

/** Every zone `weapon` holds in `s` of kind `kind`, in id order. */
export function zonesOfWeapon(
  s: WickSnapshot,
  weapon: WeaponId,
  kind?: SnapshotZone["kind"],
): SnapshotZone[] {
  return s.run.zones.filter(
    (zone) =>
      zone.weapon === weapon && (kind === undefined || zone.kind === kind),
  );
}

/** Every Chandelier lantern `s` holds, in id order. */
export function chandelierLanterns(s: WickSnapshot): SnapshotZone[] {
  return zonesOfWeapon(s, "chandelier", "lantern");
}

/** The one zone of `kind` `weapon` holds; none or several fails the check. */
export function theZone(
  s: WickSnapshot,
  weapon: WeaponId,
  kind: SnapshotZone["kind"],
): SnapshotZone {
  const found = zonesOfWeapon(s, weapon, kind);
  if (found.length !== 1) {
    fail(
      `exactly one zone of kind ${kind} with weapon ${weapon} (specs/evolutions.md)`,
      found.length,
    );
  }
  return found[0];
}

/** The `hp` enemy `id` holds in `s`; a missing enemy fails the check. */
export function hpOf(s: WickSnapshot, id: number): number {
  const enemy = enemyById(s, id);
  if (enemy === undefined) fail(`a live enemy with id ${id}`, "none");
  return enemy.hp;
}

/**
 * Whether the tick that ran hit enemy `id`, whose `hp` read `hpBefore` before
 * it: `true` when the enemy is gone or its `hp` fell, `false` when it is still
 * there at the `hp` it was posed with.
 */
export function wasHit(
  after: WickSnapshot,
  id: number,
  hpBefore: number,
): boolean {
  const enemy = enemyById(after, id);
  if (enemy === undefined) return true;
  return enemy.hp < hpBefore - REAL_EPS;
}

/** The chest result `s` reports; `null` fails the check. */
export function chestResultOf(s: WickSnapshot): ChestResult {
  const result = s.run.chestResult;
  if (result === null) {
    fail(
      "a chestResult on the tick the chest was collected (specs/progression.md, The chest overlay)",
      null,
    );
  }
  return result;
}

/** The chest's `level` result; any other result fails the check. */
export function levelResultOf(s: WickSnapshot): {
  item: WeaponId | PassiveId;
  level: number;
} {
  const result = chestResultOf(s);
  if (result.kind !== "level") {
    fail(
      "a chest result of kind level (specs/evolutions.md, Opening a chest)",
      result,
    );
  }
  return { item: result.item, level: result.level };
}

/** The lamplighter's center as `s` reports it. */
export function playerCenter(s: WickSnapshot): Point {
  const { player } = s.run;
  return { x: player.x, y: player.y };
}

/** How far `zone`'s center is from the lamplighter's center in `s`. */
export function orbitOf(s: WickSnapshot, zone: SnapshotZone): number {
  return distance(playerCenter(s), zone);
}

/**
 * The angle of `zone`'s center about the lamplighter's center in `s`, in
 * degrees in `[0, 360)`, `0` along `+x` and positive toward `+y`
 * (`specs/weapons.md`, The nearest enemy).
 */
export function angleAbout(s: WickSnapshot, zone: SnapshotZone): number {
  const center = playerCenter(s);
  return angleOf(zone.x - center.x, zone.y - center.y);
}

/**
 * Hold the base weapon of `evolution` at `weaponLevel` and its recipe passive
 * at `passiveLevel`: the arrangement `specs/evolutions.md` ("The recipe")
 * makes eligible when the weapon is at `MAX_WEAPON_LEVEL`, short of the chest
 * that opens it. The weapon slot it took.
 */
export function holdRecipe(
  h: Harness,
  evolution: EvolutionId,
  weaponLevel: number,
  passiveLevel = 1,
): number {
  const recipe = EVOLUTIONS[evolution];
  const slot = holdWeapon(h, recipe.from, weaponLevel);
  holdPassive(h, recipe.passive, passiveLevel);
  return slot;
}
