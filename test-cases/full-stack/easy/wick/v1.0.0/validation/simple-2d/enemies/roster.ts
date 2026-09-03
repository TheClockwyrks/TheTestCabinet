// enemies/roster — what the thirteen roster points share: the anchor a weaver's
// position is read against, and the one posed reading of a row's four figures.
// CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide keeps beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/enemies.md ("The roster", "The life of an enemy", "Movement") and
// specs/world.md ("Contact damage") that each roster point asserts of its own
// row.
//
// WHAT A ROW SAYS, AND HOW EACH FIGURE IS READ.
//   - HP. "A common enemy spawns with `maxHp = hp * hpMul(time)` and
//     `hp = maxHp`" (specs/enemies.md, "Health scaling"), and "Elites and the
//     Dark spawn with their table HP as `maxHp`, unscaled". A common is spawned
//     at time 0, where `hpMul` is 1, so both readings are the table figure; an
//     elite and the Dark are spawned at time 300, where `hpMul` would be 1.75,
//     so the same reading also decides that the clock left them alone.
//   - Speed. "Every rate below is per second, integrated on the fixed tick, so
//     one tick's step is `speed * TICK_DT` units" (specs/enemies.md,
//     "Movement"). One tick with `enemyMotion` on moves the enemy exactly that
//     far, whichever of the three behaviors carries it: a chaser and a drifter
//     move their position, and a weaver moves its ANCHOR, "the position minus
//     the offset at the current age" ("Weave"), which is what {@link anchorOf}
//     recovers. WHICH DIRECTION it moves is each behavior's own point.
//   - Damage. "An overlapping enemy whose `contactCooldown` is due lands a hit:
//     `hp` falls by `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`"
//     (specs/world.md, "Contact damage"), with `armor` 0 and no Brass held, and
//     "`contactCooldown`, a timer that is `0` when the enemy spawns" over "a
//     timer at `0` stays due on every tick" (specs/world.md, "Timers"), so a
//     fresh spawn hits on the first tick it overlaps.
//   - Radius. "the enemy's circle overlaps the lamplighter's when the distance
//     between their centers is less than the enemy's radius plus
//     `PLAYER_RADIUS`" (specs/world.md, "Contact damage"). The radius is
//     therefore read from BOTH sides of that sum: a probe half a unit inside it
//     is hit and a probe half a unit outside it is not. Two units separate the
//     nearest pair of radii the roster holds, so a build carrying a neighbour's
//     radius answers one of the two probes differently.
//
// WHY THE NIGHT IS POSED AS IT IS. Three isolated nights in turn, each holding
// one enemy of the row's type and nothing else, with exactly one faculty on:
// `enemyMotion` for the step, then `enemyContact` for each of the two overlap
// probes. No weapon is held, no director runs, and nothing else can move an
// enemy or change the lamplighter's hp, so the step read is the enemy's own and
// every fall in hp is a contact hit.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the health figures and on the hp a
// hit removed, each a stated figure or the product of two; `MOTION_TOLERANCE`
// (1e-6) on the length of one integrated step.

import { assertEqual, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  ENEMIES,
  FIGURE_TOLERANCE,
  MIN_DAMAGE_TAKEN,
  MOTION_TOLERANCE,
  PLAYER_RADIUS,
  TICK_DT,
  TICK_HZ,
  hpMul,
  weaveOffset,
  type EnemyId,
} from "../constants";
import {
  captureStill,
  distance,
  enable,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  type EnemySnapshot,
  type Harness,
  type Point,
} from "../harness";

/**
 * Where the enemy stands for the step reading: far enough along +x that it
 * neither overlaps the lamplighter (the widest row is the Dark's 40) nor
 * reaches it inside one tick (the fastest row is the Dark's 170 per second).
 */
const STEP_DX = 300;

/**
 * How far inside and outside the overlap sum each contact probe stands. Half a
 * unit is a quarter of the 2 units that separate the closest pair of radii the
 * roster holds, so each probe reads the row's own radius and no neighbour's.
 */
const PROBE_MARGIN = 0.5;

/** Ticks the probe outside the sum is held against the lamplighter. */
const OUTSIDE_TICKS = 3;

/**
 * The clock an elite or the Dark is spawned on: time 300, where `hpMul` is
 * 1.75, so a row read there is a row the scaling left alone. A common is
 * spawned at time 0, where the multiplier is 1.
 */
const ELITE_SPAWN_TIME = 300;

/** The anchor `enemy` weaves about, or its position for any other behavior. */
export function anchorOf(enemy: EnemySnapshot): Point {
  if (ENEMIES[enemy.type].behavior !== "weave") {
    return { x: enemy.x, y: enemy.y };
  }
  const offset = weaveOffset(enemy.age);
  return {
    x: enemy.x - -enemy.heading.y * offset,
    y: enemy.y - enemy.heading.x * offset,
  };
}

/** The run clock, in seconds, an enemy of `type` is spawned on. */
export function spawnTimeOf(type: EnemyId): number {
  return ENEMIES[type].rank === "common" ? 0 : ELITE_SPAWN_TIME;
}

/**
 * Read the four figures of `type`'s row off a build: its health at spawn, the
 * length of one step, the health one contact hit removes, and the overlap
 * distance its radius sets, keeping the frame of the contact as the point's
 * `outputId` output.
 */
export async function assertRowOf(
  h: Harness,
  type: EnemyId,
  outputId: string,
): Promise<void> {
  const row = ENEMIES[type];
  const time = spawnTimeOf(type);

  // The health at spawn, and the length of one step.
  isolate(h);
  h.debug.setTick(time * TICK_HZ);
  enable(h, "enemyMotion");
  const id = spawnEnemyNear(h, type, STEP_DX, 0);
  const spawned = present(enemyById(h.snapshot(), id), `the posed ${type}`);
  assertWithin(spawned.maxHp, row.hp, FIGURE_TOLERANCE, `${type}: maxHp`);
  assertWithin(spawned.hp, row.hp, FIGURE_TOLERANCE, `${type}: hp at spawn`);
  assertEqual(
    row.rank === "common" ? hpMul(time) === 1 : hpMul(time) > 1,
    true,
    `${type}: the clock the row is read on leaves the row's HP as the table's`,
  );
  const before = anchorOf(spawned);
  const moved = present(
    enemyById(await h.tick(1), id),
    `the ${type} after one tick`,
  );
  assertWithin(
    distance(before, anchorOf(moved)),
    row.speed * TICK_DT,
    MOTION_TOLERANCE,
    `${type}: the length of one step`,
  );

  // The health one contact hit removes, from a probe inside the overlap sum.
  isolate(h);
  h.debug.setTick(time * TICK_HZ);
  enable(h, "enemyContact");
  spawnEnemyNear(h, type, row.radius + PLAYER_RADIUS - PROBE_MARGIN, 0);
  const hit = await h.tick(1);
  captureStill(h, outputId);
  assertWithin(
    hit.run.player.hp,
    BASE_MAX_HP - Math.max(MIN_DAMAGE_TAKEN, row.damage),
    FIGURE_TOLERANCE,
    `${type}: the lamplighter's hp after one hit`,
  );

  // The same probe outside the overlap sum reaches nothing.
  isolate(h);
  h.debug.setTick(time * TICK_HZ);
  enable(h, "enemyContact");
  spawnEnemyNear(h, type, row.radius + PLAYER_RADIUS + PROBE_MARGIN, 0);
  const clear = await h.tick(OUTSIDE_TICKS);
  assertWithin(
    clear.run.player.hp,
    BASE_MAX_HP,
    FIGURE_TOLERANCE,
    `${type}: the lamplighter's hp with the ${type} outside the overlap`,
  );
}
