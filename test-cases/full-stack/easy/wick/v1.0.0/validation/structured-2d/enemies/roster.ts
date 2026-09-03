// enemies/roster — one posed reading of one enemy's ENEMIES row, shared by the
// thirteen row checks in this directory. CASE-PROVIDED.
//
// WHAT EVERY ROW CHECK SHARES. `specs/enemies.md` ("The roster") gives each
// type a health, a speed, a contact damage, and a radius, and each row check
// reads exactly those four off one posed enemy of its type. The arrangement is
// spelled once here and decides nothing: the enemy is placed through the
// surface's real spawn path, the four readings come from ticks of the real
// simulation, and each check compares them against its own row.
//
// WHY THE FOUR READINGS ARE TAKEN THE WAY THEY ARE.
//   - HEALTH is a snapshot field, read on the spawn tick before anything runs.
//   - THE SPEED is read as the distance one tick moves the enemy with
//     `enemyMotion` on: "Every rate below is per second, integrated on the
//     fixed tick, so one tick's step is `speed * TICK_DT` units" (Movement).
//     For a chaser and a drifter that is the position; for a weaver it is the
//     ANCHOR, since "The anchor is what advances toward the lamplighter" and
//     the position carries the weave offset on top of it (Weave). {@link
//     stepPointOf} recovers whichever of the two the behavior advances.
//   - THE CONTACT DAMAGE is read as the health the lamplighter loses on one
//     tick an overlapping enemy hits: `specs/world.md` ("Contact damage") has
//     `hp` fall by `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, and `armor`
//     "is `0` with no Brass held", so the loss is the row's damage for every
//     row here.
//   - THE RADIUS is NOT a snapshot field. What the specification fixes it
//     through is the overlap: "the enemy's circle overlaps the lamplighter's
//     when the distance between their centers is less than the enemy's radius
//     plus `PLAYER_RADIUS`" (`specs/world.md`, Contact damage). So it is read
//     from both sides of that bound at once, one unit inside and one unit
//     outside, which is one measurement of one figure rather than two claims:
//     a hit inside and no hit outside is satisfied by no radius but the row's.
//     Where the bound falls EXACTLY is `contact/contact-overlap-strict`'s
//     point, which is why neither reading is taken at the bound itself.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but the one
// enemy: no weapon to kill it, no other enemy, and every driver switch off but
// the one the reading under way needs, so nothing arrives on top of the
// behavior being read. The lamplighter never moves, so the chase heading and
// the contact geometry are the posed ones.
//
// WHEN THE ENEMY IS SPAWNED. A common at a run clock of `0`, where `hpMul(0)`
// is `1` ("Health scaling"), so its `maxHp` is its table HP. An elite and the
// Dark at `ELITE_TIME`, a clock five minutes in where `hpMul` is `1.75`, since
// the claim about them is that they spawn "with exactly the HP in its row"
// whatever the clock reads ("Elites and the Dark").

import { fail } from "../assert";
import {
  ENEMIES,
  PLAYER_RADIUS,
  TICK_HZ,
  weaveOffset,
  type EnemyId,
} from "../constants";
import {
  advanceTicks,
  disable,
  distance,
  enable,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
  type Point,
  type SnapshotEnemy,
  type WickSnapshot,
} from "../harness";

/**
 * How far from the lamplighter's center a row's enemy is spawned. Far enough
 * that one tick of the fastest row (the Dark's `170`, under three units) comes
 * nowhere near the lamplighter, so the step is read in open ground.
 */
export const FAR = 400;

/**
 * The run clock an elite and the Dark are spawned at, in seconds: five minutes
 * in, where `hpMul` reads `1.75`, so a health that still equals the table row
 * can only be an unscaled one.
 */
export const ELITE_TIME = 300;

/** How far inside and outside the overlap bound the contact readings are taken. */
export const BOUND_MARGIN = 1;

/** The center distance inside which enemy `type` overlaps the lamplighter. */
export function overlapBound(type: EnemyId): number {
  return ENEMIES[type].radius + PLAYER_RADIUS;
}

/** The enemy `id` in `s`; a missing one fails the check that asked. */
export function requireEnemy(s: WickSnapshot, id: number): SnapshotEnemy {
  const enemy = enemyById(s, id);
  if (enemy === undefined) fail(`a live enemy with id ${id}`, "none");
  return enemy;
}

/**
 * The point one tick of movement advances by `speed × TICK_DT`: the position
 * for a chaser and a drifter, and the ANCHOR for a weaver.
 *
 * `specs/enemies.md` ("Weave") states the recovery outright: "The state
 * carries the position and the heading, and the anchor is the position minus
 * the offset at the current age", the offset laid along the perpendicular
 * `(-hy, hx)` of the heading.
 */
export function stepPointOf(enemy: SnapshotEnemy): Point {
  if (ENEMIES[enemy.type].behavior !== "weave") {
    return { x: enemy.x, y: enemy.y };
  }
  const offset = weaveOffset(enemy.age);
  return {
    x: enemy.x + enemy.heading.y * offset,
    y: enemy.y - enemy.heading.x * offset,
  };
}

/** What one posed enemy's row reads. */
export interface RowReading {
  /** `hp` on the spawn tick, before anything runs. */
  hp: number;
  /** `maxHp` on the spawn tick. */
  maxHp: number;
  /** How far one tick with `enemyMotion` on advanced the step point. */
  step: number;
  /** The health the lamplighter lost with the enemy one unit inside the bound. */
  insideLoss: number;
  /** The health it lost with the enemy one unit outside the bound. */
  outsideLoss: number;
}

/**
 * Pose one enemy of `type` in an isolated run and read its row: its health at
 * spawn, the distance one tick of motion advances it, and what its contact
 * does one unit inside and one unit outside its overlap bound.
 *
 * The last of those ticks leaves the enemy standing beside the lamplighter at
 * its own size, which is the frame each row check keeps as its still.
 */
export async function readRow(h: Harness, type: EnemyId): Promise<RowReading> {
  const rank = ENEMIES[type].rank;
  const bound = overlapBound(type);

  isolate(h);
  if (rank !== "common") h.debug.setTick(ELITE_TIME * TICK_HZ);
  const id = placeEnemyNear(h, type, FAR, 0);
  const spawned = requireEnemy(h.snapshot(), id);

  // The step: the one switch the reading needs, for the one tick it needs.
  enable(h, "enemyMotion");
  const moved = requireEnemy(await advanceTicks(h, 1), id);
  disable(h, "enemyMotion");
  const step = distance(stepPointOf(moved), stepPointOf(spawned));

  // The hit, one unit inside the bound. A fresh enemy's cooldown is `0` and a
  // timer at `0` "stays due on every tick until it is set again"
  // (`specs/world.md`, Timers), so the hit lands on the next tick.
  const { player } = h.snapshot().run;
  h.debug.setEnemyPosition(id, player.x + bound - BOUND_MARGIN, player.y);
  h.debug.setEnemyContactCooldown(id, 0);
  enable(h, "enemyContact");
  const beforeInside = h.snapshot().run.player.hp;
  const afterInside = (await advanceTicks(h, 1)).run.player.hp;

  // And no hit one unit outside it, with the cooldown the hit set posed back
  // to `0` so the only thing standing between the enemy and a hit is the
  // overlap.
  h.debug.setEnemyPosition(id, player.x + bound + BOUND_MARGIN, player.y);
  h.debug.setEnemyContactCooldown(id, 0);
  const afterOutside = (await advanceTicks(h, 1)).run.player.hp;

  return {
    hp: spawned.hp,
    maxHp: spawned.maxHp,
    step,
    insideLoss: beforeInside - afterInside,
    outsideLoss: afterInside - afterOutside,
  };
}
