// oil-splash/firing — one posed Oil Splash firing, shared by the checks in
// this directory. CASE-PROVIDED.
//
// WHAT EVERY CHECK HERE SHARES. Oil Splash "fires whether or not any enemy
// exists" (`specs/weapons.md`, Oil Splash), so every check on a puddle poses
// an isolated run holding nothing at all, holds Oil Splash at the level under
// test, and runs the one tick on which it fires. That arrangement is spelled
// once here and decides nothing: Oil Splash is placed through `setWeapon`, the
// firing through `setWeaponCooldown(slot, 0)` and `weaponFire` on
// ("`setWeaponCooldown(slot, 0)` makes that the next tick",
// `specs/instrumentation.md`), and what the tick created is read back by id,
// telling this tick's puddles from anything posed or fired before it.
//
// WHY THE PUDDLES ARE READ WHERE THEY LANDED. `specs/world.md` ("One tick"),
// phase 5, has a due weapon fire "creating its projectiles and zones at the
// lamplighter's and the enemies' positions of this tick", and
// `specs/weapons.md` (Oil Splash) has a puddle "stay where it landed for
// `duration` seconds" — so after the firing tick every puddle sits at its
// landing point, and the lamplighter, holding no key, sits where the check
// posed it. Every other switch is off, so no director spawn, no motion, and
// no contact arrives on top of the firing.
//
// THE PUDDLES ARE SELECTED BY WEAPON, NOT BY KIND. A build that produced the
// right zones under the wrong `kind` must fail on the kind, not vanish from
// the count, so the zones the firing created are taken by `weapon` alone and
// each check reads `kind` for itself.
//
// HOW A MOTH IS PUT UNDER A LANDING POINT. A puddle lands at a draw from the
// disk of radius `OIL_SCATTER` about the lamplighter (`specs/weapons.md`, Oil
// Splash), so no single moth can be posed under it. The lattice below tiles
// that disk with moths at a spacing whose circumradius is under the distance
// at which a puddle and a moth overlap, so wherever the puddle lands the moth
// nearest its center overlaps it. That guarantee is this file's arrangement
// rather than anything the build decides, and a check that wanted it and did
// not get it fails itself rather than the build.

import {
  advanceTicks,
  armWeapon,
  distance,
  holdWeapon,
  isolate,
  placeEnemy,
  zonesCreatedSince,
  type Harness,
  type Point,
  type SnapshotEnemy,
  type SnapshotZone,
  type WickSnapshot,
} from "../harness";
import { ENEMIES, OIL_SCATTER } from "../constants";

/** What one posed firing tick left. */
export interface Firing {
  /** The slot Oil Splash was placed in. */
  slot: number;
  /** The state before the firing tick, with Oil Splash armed. */
  before: WickSnapshot;
  /** The state after the firing tick. */
  after: WickSnapshot;
  /** The Oil Splash zones the firing tick created, in id order. */
  puddles: SnapshotZone[];
}

/** The zones `after` holds that `before` did not, produced by Oil Splash. */
export function puddlesCreated(
  before: WickSnapshot,
  after: WickSnapshot,
): SnapshotZone[] {
  return zonesCreatedSince(before, after).filter(
    (zone) => zone.weapon === "oil-splash",
  );
}

/**
 * Pose an isolated run, hold Oil Splash at `level` armed to fire on the next
 * tick, run that one tick, and read what it left.
 *
 * `isolate` first, so the run holds nothing but Oil Splash: no enemy, no
 * other weapon (Taper removed), no passive, every driver switch off but the
 * `weaponFire` that `armWeapon` turns on. The lamplighter is at the origin,
 * where the fresh run starts it, unless `center` names where to pose it
 * before the firing.
 */
export async function fireOilSplash(
  h: Harness,
  level: number,
  center?: { x: number; y: number },
): Promise<Firing> {
  isolate(h);
  if (center !== undefined) h.debug.setPlayerPosition(center.x, center.y);
  return fireFromPosed(h, level);
}

/**
 * Hold Oil Splash at `level` in the run AS IT STANDS, armed to fire on the
 * next tick, run that one tick, and read what it left: the firing half of
 * `fireOilSplash`, for a check that isolates for itself and poses the world
 * the firing lands in before the weapon is held.
 */
export async function fireFromPosed(
  h: Harness,
  level: number,
): Promise<Firing> {
  const slot = holdWeapon(h, "oil-splash", level);
  armWeapon(h, slot);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return { slot, before, after, puddles: puddlesCreated(before, after) };
}

/**
 * Fire Oil Splash once more from the run `fireOilSplash` posed: its timer
 * posed back to `0` so the next tick is a firing, that one tick run, and the
 * puddles it created read back. `weaponFire` is still on from `armWeapon`,
 * and nothing else in the world is touched, so its landing points are a fresh
 * draw of the build's own.
 */
export async function fireAgain(h: Harness, slot: number): Promise<Firing> {
  h.debug.setWeaponCooldown(slot, 0);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return { slot, before, after, puddles: puddlesCreated(before, after) };
}

/** The moth lattice's spacing, in units. */
export const LATTICE_SPACING = 100;

/**
 * The lattice's circumradius: the farthest any point of the plane is from a
 * node of a triangular lattice of `LATTICE_SPACING`, `100 / sqrt(3)` ≈ 57.7.
 * A moth is under every point of the disk when this is under the distance at
 * which the puddle's circle and the moth's overlap.
 */
export const LATTICE_CIRCUMRADIUS = LATTICE_SPACING / Math.sqrt(3);

/** The distance under which a moth's circle overlaps a puddle of `radius`. */
export function mothOverlap(radius: number): number {
  return radius + ENEMIES.moth.radius;
}

/**
 * The lattice nodes covering the scatter disk: every node of a triangular
 * lattice of `LATTICE_SPACING` within `OIL_SCATTER + LATTICE_CIRCUMRADIUS` of
 * the origin, which is far enough out that a node covers every point of the
 * scatter disk. The lattice is offset off the origin, so no moth is posed on
 * the lamplighter, where the fresh run stands.
 */
export function mothLattice(): Point[] {
  const rowHeight = (LATTICE_SPACING * Math.sqrt(3)) / 2;
  const reach = OIL_SCATTER + LATTICE_CIRCUMRADIUS;
  const offset = { x: LATTICE_SPACING / 2, y: LATTICE_CIRCUMRADIUS };
  const nodes: Point[] = [];
  const rows = Math.ceil(reach / rowHeight) + 1;
  const cols = Math.ceil(reach / LATTICE_SPACING) + 1;
  for (let j = -rows; j <= rows; j += 1) {
    for (let i = -cols; i <= cols; i += 1) {
      const x = offset.x + LATTICE_SPACING * (i + (j & 1) * 0.5);
      const y = offset.y + rowHeight * j;
      if (Math.hypot(x, y) <= reach) nodes.push({ x, y });
    }
  }
  return nodes;
}

/**
 * Pose one moth at each node of `mothLattice`, covering the scatter disk
 * about the origin, and answer their ids. The moths are well apart, and the
 * caller leaves `enemyMotion` and `enemyContact` off, so they hold their
 * centers and touch nothing.
 */
export function coverScatterDisk(h: Harness): number[] {
  return mothLattice().map((node) => placeEnemy(h, "moth", node.x, node.y));
}

/** The enemy nearest `point`, and how far its center is from it. */
export function nearestEnemy(
  enemies: readonly SnapshotEnemy[],
  point: Point,
): { enemy: SnapshotEnemy; reach: number } {
  const first = enemies[0];
  if (first === undefined) {
    throw new Error("the lattice must hold at least one moth");
  }
  let best = { enemy: first, reach: distance(first, point) };
  for (const enemy of enemies) {
    const reach = distance(enemy, point);
    if (reach < best.reach) best = { enemy, reach };
  }
  return best;
}
