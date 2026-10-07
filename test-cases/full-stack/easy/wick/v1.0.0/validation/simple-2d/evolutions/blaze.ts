// evolutions/blaze — what the points about Blaze share: the puddles read off a
// snapshot, one firing driven at a time, and the lattice of moths a landing
// pulse is observed against. CASE-PROVIDED.
//
// No review item names this file. The readings restate the rules of
// specs/evolutions.md ("Blaze") and specs/weapons.md ("Shapes and overlap")
// that the points of this category assert the same way.
//
// WHY A LATTICE. A Blaze puddle lands at "an independent uniformly random point
// of the disk of radius `OIL_SCATTER` (`400`) about the player's center"
// (specs/evolutions.md), and the order a build draws from its generator is its
// own ("The order in which the systems draw from it is yours",
// specs/instrumentation.md), so no point can know a landing point before the
// firing tick. A point about the pulse on the tick a puddle APPEARS therefore
// stands a moth on every point of a square lattice of pitch `LATTICE_PITCH`
// (100) covering the disk. The farthest a point of the plane can be from its
// nearest lattice point is half the pitch's diagonal, 100 / sqrt(2) ≈ 70.7, and
// a puddle of radius 70 overlaps a moth of radius 10 whose center is less than
// 80 away, so wherever a puddle lands at least one moth overlaps it.

import {
  BLAZE_STATS,
  ENEMIES,
  FIGURE_TOLERANCE,
  OIL_SCATTER,
} from "../constants";
import {
  distance,
  spawnEnemyAt,
  zonesOf,
  type Harness,
  type Point,
  type WickSnapshot,
  type ZoneSnapshot,
} from "../harness";

/** Every Blaze puddle in `snapshot`, ascending by id. */
export function blazePuddles(snapshot: WickSnapshot): ZoneSnapshot[] {
  return zonesOf(snapshot, "blaze").filter((zone) => zone.kind === "puddle");
}

/**
 * Make Blaze in `slot` fire on the next tick and run that tick; the puddles
 * that tick created, which are the Blaze puddles whose ids were not in `zones`
 * before it ("A pose that creates an entity gives it the next id from
 * `nextId`", specs/instrumentation.md, and `ZoneState.id` is "unique for the
 * run", specs/state.md).
 */
export async function fireOnce(
  h: Harness,
  slot: number,
): Promise<{ after: WickSnapshot; created: ZoneSnapshot[] }> {
  const before = new Set(blazePuddles(h.snapshot()).map((zone) => zone.id));
  h.debug.setWeaponCooldown(slot, 0);
  const after = await h.tick(1);
  const created = blazePuddles(after).filter((zone) => !before.has(zone.id));
  return { after, created };
}

/** The enemy a lattice is made of: the smallest common, HP 5 and radius 10. */
export const LATTICE_ENEMY = "moth";

/** The pitch of the moth lattice, in units. */
export const LATTICE_PITCH = 100;

/**
 * How far from the lamplighter's center the lattice reaches: the scatter disk
 * plus half a diagonal, so the nearest lattice point to any landing point,
 * itself within half a diagonal of the disk, is one that was posed.
 */
export const LATTICE_REACH = OIL_SCATTER + LATTICE_PITCH / Math.SQRT2;

/** One moth of the lattice: its id and where it stands. */
export interface LatticeMoth {
  id: number;
  at: Point;
}

/**
 * Stand a moth on every point of the square lattice of pitch
 * {@link LATTICE_PITCH} centered on `center` and within {@link LATTICE_REACH}
 * of it, so a Blaze puddle landing anywhere in the scatter disk overlaps at
 * least one.
 */
export function poseMothLattice(h: Harness, center: Point): LatticeMoth[] {
  const moths: LatticeMoth[] = [];
  const steps = Math.ceil(LATTICE_REACH / LATTICE_PITCH);
  for (let i = -steps; i <= steps; i += 1) {
    for (let j = -steps; j <= steps; j += 1) {
      const at: Point = {
        x: center.x + i * LATTICE_PITCH,
        y: center.y + j * LATTICE_PITCH,
      };
      if (distance(at, center) > LATTICE_REACH) continue;
      moths.push({ id: spawnEnemyAt(h, LATTICE_ENEMY, at.x, at.y), at });
    }
  }
  return moths;
}

/**
 * Whether a moth standing at `at` overlaps a puddle centered at `center`: "Two
 * circles overlap when the distance between their centers is less than the sum
 * of their radii" (specs/weapons.md, "Shapes and overlap"). A moth within
 * `FIGURE_TOLERANCE` of the boundary is left out, because the exact overlap
 * boundary belongs to the overlap point and a build's own rounding may put such
 * a moth on either side of it.
 */
export function overlapsPuddle(at: Point, center: Point): boolean {
  return (
    distance(at, center) <
    BLAZE_STATS.radius + ENEMIES[LATTICE_ENEMY].radius - FIGURE_TOLERANCE
  );
}
