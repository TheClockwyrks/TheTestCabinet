// Wick — lantern/set: one posed Lantern firing, shared by the checks in this
// directory. CASE-PROVIDED.
//
// WHAT EVERY CHECK HERE SHARES. Lantern "need[s] no target" and fires "on the
// first `playing` tick it is held" (`specs/weapons.md`, Cooldown timers), so
// every check on a set poses an isolated run holding nothing at all, holds
// Lantern at the level under test, and runs the one tick on which it fires.
// That arrangement is spelled once here and decides nothing: Lantern is placed
// through `setWeapon`, the firing through `setWeaponCooldown(slot, 0)` and
// `weaponFire` on ("`setWeaponCooldown(slot, 0)` makes that the next tick",
// `specs/instrumentation.md`), and what the tick created is read back by id,
// telling this tick's lanterns from anything posed before it.
//
// WHY THE LANTERNS ARE READ WHERE THEY WERE FIRED. `specs/world.md` ("One
// tick"), phase 5, has a due weapon fire "creating its projectiles and zones
// at the lamplighter's and the enemies' positions of this tick", and
// `specs/weapons.md` ("Lantern") has the lanterns start on the firing tick
// and revolve "From the next tick" — so after the firing tick every lantern
// still sits at its start angle. `effectMotion` is off in an isolated run
// anyway, so no lantern revolves on any later tick a check might run unless
// the check turns it on.
//
// WHERE THE LAMPLIGHTER STANDS. A fresh run starts it at `(0, 0)`
// (`specs/world.md`, The lamplighter), so a circle laid about the world origin
// and one laid about the lamplighter's center would be indistinguishable.
// {@link fireLantern} therefore takes an optional center and poses it through
// `setPlayerPosition`, which "Sets the lamplighter's center to `(x, y)`.
// Nothing else moves" (`specs/instrumentation.md`); {@link POSED} is the
// center the checks that read a distance or an angle use, off the origin and
// off both axes.
//
// THE GEOMETRY. `specs/weapons.md` ("Lantern"): the lanterns sit "on a circle
// of radius `orbit` around the player's center", and ("The nearest enemy"):
// "Angles are in degrees, with `0` along `+x` and positive angles turning
// toward `+y`". A lantern's angle is read off its center relative to the
// lamplighter's center in the same snapshot, under exactly that convention.

import {
  advanceTicks,
  angleOf,
  armWeapon,
  distance,
  holdWeapon,
  isolate,
  zonesCreatedSince,
  type Harness,
  type Point,
  type SnapshotZone,
  type WickSnapshot,
} from "../harness";

/**
 * Where the lamplighter stands for a check that reads a lantern's distance or
 * angle: a center that is neither the origin nor on either axis.
 */
export const POSED: Point = { x: 200, y: -140 };

/** What one posed firing tick left. */
export interface Firing {
  /** The slot Lantern was placed in. */
  slot: number;
  /** The state before the firing tick, with Lantern armed. */
  before: WickSnapshot;
  /** The state after the firing tick. */
  after: WickSnapshot;
  /** The Lantern lantern zones the firing tick created, in id order. */
  lanterns: SnapshotZone[];
}

/**
 * Hold Lantern at `level` in the first free weapon slot and make it fire on
 * the next tick: its timer at `0` and `weaponFire` on. The slot it took.
 */
export function armLantern(h: Harness, level: number): number {
  const slot = holdWeapon(h, "lantern", level);
  armWeapon(h, slot);
  return slot;
}

/** The Lantern lanterns `after` holds that did not exist when `before` was read. */
export function lanternsCreatedSince(
  before: WickSnapshot,
  after: WickSnapshot,
): SnapshotZone[] {
  return zonesCreatedSince(before, after).filter(
    (zone) => zone.kind === "lantern" && zone.weapon === "lantern",
  );
}

/** Every Lantern lantern `s` holds, in id order. */
export function lanternsOf(s: WickSnapshot): SnapshotZone[] {
  return s.run.zones.filter(
    (zone) => zone.kind === "lantern" && zone.weapon === "lantern",
  );
}

/**
 * Pose an isolated run, hold Lantern at `level` armed to fire on the next
 * tick, run that one tick, and read what it left.
 *
 * `isolate` first, so the run holds nothing but Lantern: no enemy, no other
 * weapon (Taper removed), no passive, every driver switch off but the
 * `weaponFire` that `armWeapon` turns on. A check that wants something else
 * in the world before the firing — an enemy under the orbit — arranges it
 * with the pieces above instead. `at` moves the lamplighter before the firing,
 * so a check that reads a distance or an angle measures it from a center that
 * is not the origin; omitted, the fresh run's origin stands.
 */
export async function fireLantern(
  h: Harness,
  level: number,
  at?: Point,
): Promise<Firing> {
  isolate(h);
  if (at !== undefined) h.debug.setPlayerPosition(at.x, at.y);
  const slot = armLantern(h, level);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return { slot, before, after, lanterns: lanternsCreatedSince(before, after) };
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
 * degrees in `[0, 360)`, `0` along `+x` and positive toward `+y`.
 */
export function angleAbout(s: WickSnapshot, zone: SnapshotZone): number {
  const center = playerCenter(s);
  return angleOf(zone.x - center.x, zone.y - center.y);
}
