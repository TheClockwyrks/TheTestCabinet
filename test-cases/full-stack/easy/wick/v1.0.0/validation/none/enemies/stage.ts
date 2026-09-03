// enemies/stage — what the roster checks share: the anchor a weaver's state
// hides, the one row check the thirteen `<type>-row` points each run against
// their own row of `ENEMIES`, and the one drop check the thirteen drop points
// run against their own row's `Gem`/`Drops` column.
//
// THE ROSTER ROW. `specs/enemies.md` ("The roster"): "An enemy is a circle of
// `radius` units centered on its position `(x, y)` in world units, with `hp`
// health, a `speed` in units per second, and a contact `damage`", and the two
// tables give each of the thirteen its row. A row is therefore four figures a
// check can read back off one posed enemy: the health it spawns with, the
// distance it covers in a tick, the health a touch takes from the lamplighter,
// and the radius its circle is tested at.
//
// WHERE EACH IS READ. The health at spawn is "It spawns at full health" with
// `maxHp = hp * hpMul(time)` for a common and the table `hp` "unscaled" for an
// elite and the Dark ("Health scaling"), read straight off the spawn. The
// speed is "one tick's step is `speed * TICK_DT` units" ("Movement"), read as
// the distance the enemy's track covered over one tick with `enemyMotion` on.
// The damage is `specs/world.md` ("Contact damage"): "An overlapping enemy
// whose `contactCooldown` is due lands a hit: `hp` falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`", with `armor` `0` and no
// weapon or passive held, read as the lamplighter's health after one tick. The
// radius is the same sentence's overlap test, "the distance between their
// centers is less than the enemy's radius plus `PLAYER_RADIUS`", read from both
// sides: an enemy `OVERLAP_MARGIN` inside the sum hits, and one the same margin
// outside it does not. The margin is half a unit, a quarter of the two units
// between the closest pair of radii the roster distinguishes.
//
// THE TRACK. A chaser and a drifter advance their position; a weaver advances
// its ANCHOR, and "the anchor is the position minus the offset at the current
// age" ("Weave"), so the point that moves at `speed` is the anchor for a
// weaver and the position for everything else. {@link trackOf} is that point.
//
// THE CLOCK. A common's `maxHp` is scaled by the run clock, so the commons are
// posed at tick `0`, where `hpMul(0)` is `1` and the table figure is the whole
// of it. An elite and the Dark are posed at {@link UNSCALED_TICK}, five minutes
// in, where a common's multiplier would be `1.75`, so a build that scaled them
// too reads a health the check separates from the table's.
//
// THE DROP. `specs/enemies.md` ("Drops"): "A death leaves its drop at the
// enemy's center on the tick it dies", one gem of the row's tier for a common,
// one chest for an elite, and nothing for the Dark; `specs/world.md` ("Gems")
// repeats it as "Every common enemy drops one gem of the tier
// `specs/enemies.md` lists for its type, at the enemy's position, on the tick
// it dies". The kill is a weapon's, as the points state: a level-1 Ember bolt
// carries `10` damage (`specs/weapons.md`, row 1 of `EMBER_LEVELS`, times a
// `damageMul` of `1`), posed on the enemy's own center, and the enemy's `hp` is
// posed to {@link KILL_HP} first so one bolt takes every row below `0`
// whatever its table health.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, assertUndefined, fail } from "../assert";
import {
  BASE_MAX_HP,
  ENEMIES,
  EMBER_LEVELS,
  FLOAT_TOL,
  PLAYER_RADIUS,
  POSITION_TOL,
  TICK_DT,
  TICK_HZ,
  type EnemyId,
  type GemTier,
  wispOffset,
} from "../constants";
import {
  captureStill,
  distanceBetween,
  enemyById,
  enable,
  isolate,
  mustEnemy,
  newGems,
  newPickups,
  placeEnemy,
  placeProjectile,
  player,
  type EnemyView,
  type Harness,
  type WickSnapshot,
  type XY,
} from "../harness";

/**
 * The run clock the elites and the Dark are posed at, in ticks: five minutes,
 * where `hpMul(300)` is `1.75` for a common and the table figure alone for
 * them.
 */
export const UNSCALED_TICK = 300 * TICK_HZ;

/**
 * How far along `+x` an enemy stands for the step reading: clear of every
 * radius the roster holds, of the `48` pickup radius, and of the `1200`
 * despawn distance, so one tick of motion is all that happens to it.
 */
export const STEP_GAP = 300;

/**
 * How far inside and outside the overlap sum an enemy stands for the radius
 * reading: half a unit, a quarter of the two units between the closest pair of
 * radii `ENEMIES` distinguishes.
 */
export const OVERLAP_MARGIN = 0.5;

/**
 * The health a drop check poses an enemy to before the bolt lands: one, which
 * every row's `maxHp` is above ("a real number above `0` and at most its
 * `maxHp`", `specs/instrumentation.md`) and Ember's `10` takes below `0`.
 */
export const KILL_HP = 1;

/** Row 1 of `EMBER_LEVELS`, the damage a posed bolt carries: `10`. */
export const BOLT_DAMAGE = EMBER_LEVELS[0]!.damage;

/**
 * Where a drop check kills its enemy: `150` along `+x`, beyond the `48`
 * pickup radius, so the drop is neither attracted nor collected on the tick it
 * lands and lies where the enemy died.
 */
export const KILL_AT: XY = { x: 150, y: 0 };

/** The perpendicular of a heading, "`(-hy, hx)` the heading rotated +90 degrees". */
export function perpOf(heading: XY): XY {
  return { x: -heading.y, y: heading.x };
}

/**
 * The point that advances at the enemy's `speed`: "the anchor is the position
 * minus the offset at the current age" for a weaver ("Weave"), and the
 * position itself for a chaser or a drifter.
 */
export function trackOf(enemy: EnemyView): XY {
  if (ENEMIES[enemy.type].behavior !== "weave") {
    return { x: enemy.x, y: enemy.y };
  }
  const perp = perpOf(enemy.heading);
  const offset = wispOffset(enemy.age);
  return { x: enemy.x - perp.x * offset, y: enemy.y - perp.y * offset };
}

/**
 * The `<type>-row` check: read `type`'s four `ENEMIES` figures back off one
 * posed enemy, on a night holding nothing else.
 *
 * The health and the step come from one pose, so the still shows the enemy
 * mid-stride; the damage and the two sides of the radius come from three more,
 * each on a night isolated again so the lamplighter is back at full health and
 * the enemy is the only thing on the field.
 *
 * TOLERANCE. `FLOAT_TOL` on the health figures and on the lamplighter's health
 * after a hit, each a table figure or a difference of two; `POSITION_TOL` on
 * the step, a speed times `TICK_DT` (`1/60`, inexact in binary). The nearest
 * wrong answers are whole units away: the closest pair of speeds in the roster
 * is `10` units per second apart and the closest pair of damages `2`.
 */
export async function checkEnemyRow(h: Harness, type: EnemyId): Promise<void> {
  const row = ENEMIES[type];
  const scaled = row.rank === "common";

  // The health it spawns with, and the distance one tick of motion covers.
  await poseNight(h, scaled);
  const spawned = await placeEnemy(h, type, STEP_GAP, 0);
  await enable(h, "enemyMotion");
  const moved = await h.step(1);
  await captureStill(h, "row");

  assertNear(spawned.maxHp, row.hp, FLOAT_TOL, `the ${type}'s maxHp at spawn`);
  assertNear(spawned.hp, row.hp, FLOAT_TOL, `the ${type}'s hp at spawn`);
  assertNear(
    distanceBetween(trackOf(spawned), trackOf(mustEnemy(moved, spawned.id))),
    row.speed * TICK_DT,
    POSITION_TOL,
    `the ${type}'s step over one tick with enemyMotion on`,
  );

  // The health one touch takes, from just inside the overlap sum.
  const reach = row.radius + PLAYER_RADIUS;
  await poseNight(h, scaled);
  await enable(h, "enemyContact");
  await placeEnemy(h, type, reach - OVERLAP_MARGIN, 0);
  const hit = await h.step(1);
  assertNear(
    player(hit).hp,
    BASE_MAX_HP - row.damage,
    FLOAT_TOL,
    `the lamplighter's hp after one tick with a ${type} at ${reach - OVERLAP_MARGIN}`,
  );

  // And nothing from just outside it.
  await poseNight(h, scaled);
  await enable(h, "enemyContact");
  await placeEnemy(h, type, reach + OVERLAP_MARGIN, 0);
  const clear = await h.step(1);
  assertNear(
    player(clear).hp,
    BASE_MAX_HP,
    FLOAT_TOL,
    `the lamplighter's hp after one tick with a ${type} at ${reach + OVERLAP_MARGIN}`,
  );
}

/**
 * An isolated night with the clock posed where the row's health is the table's
 * alone: tick `0` for a common, {@link UNSCALED_TICK} for an elite and the
 * Dark.
 */
async function poseNight(h: Harness, scaled: boolean): Promise<void> {
  await isolate(h);
  if (!scaled) await h.debug.setTick(UNSCALED_TICK);
}

/** What one posed kill left: the tick's snapshot and the state before it. */
export interface Death {
  before: WickSnapshot;
  after: WickSnapshot;
  /** The enemy as it was posed, before the bolt landed. */
  posed: EnemyView;
}

/**
 * Pose one `type` at {@link KILL_AT} with {@link KILL_HP} health and a level-1
 * Ember bolt on its center, run the tick the bolt hits on, and answer what the
 * tick left.
 *
 * Every faculty is held: `enemyMotion`, so the enemy dies exactly where it was
 * posed, and the rest so nothing else lands in the night. A bolt "hit[s] at the
 * position it was created at" on the tick it exists for (`specs/world.md`,
 * phase 6), so the tick is the whole scenario.
 */
export async function killOne(h: Harness, type: EnemyId): Promise<Death> {
  await isolate(h);
  const posed = await placeEnemy(h, type, KILL_AT.x, KILL_AT.y);
  await h.debug.setEnemyHp(posed.id, KILL_HP);
  await placeProjectile(h, "ember", KILL_AT.x, KILL_AT.y, 0, 0, 0);
  const before = await h.snapshot();
  const after = await h.step(1);
  return { before, after, posed };
}

/**
 * The `<type>-drops-<tier>-gem` check: `type` killed by a bolt leaves exactly
 * one gem of `tier` at the center it died at, and no chest.
 *
 * TOLERANCE. `POSITION_TOL` on the gem's position, a copy of the posed center;
 * the count and the tier are exact.
 */
export async function checkGemDrop(
  h: Harness,
  type: EnemyId,
  tier: GemTier,
): Promise<void> {
  const death = await killOne(h, type);
  await captureStill(h, "drop");

  assertDead(death, type);
  const gems = newGems(death.before, death.after);
  assertEqual(gems.length, 1, `the gems the ${type}'s death dropped`);
  const gem = gems[0]!;
  assertEqual(gem.tier, tier, `the tier of the ${type}'s gem`);
  assertNear(gem.x, KILL_AT.x, POSITION_TOL, `the ${type}'s gem's x`);
  assertNear(gem.y, KILL_AT.y, POSITION_TOL, `the ${type}'s gem's y`);
  assertEqual(
    newPickups(death.before, death.after).filter(
      (pickup) => pickup.kind === "chest",
    ).length,
    0,
    `the chests the ${type}'s death dropped`,
  );
}

/**
 * The `<type>-drops-chest` check: `type` killed by a bolt leaves exactly one
 * chest at the center it died at, and no gem.
 *
 * TOLERANCE. `POSITION_TOL` on the chest's position, a copy of the posed
 * center; the counts are exact.
 */
export async function checkChestDrop(h: Harness, type: EnemyId): Promise<void> {
  const death = await killOne(h, type);
  await captureStill(h, "chest");

  assertDead(death, type);
  const pickups = newPickups(death.before, death.after);
  assertEqual(pickups.length, 1, `the pickups the ${type}'s death dropped`);
  const chest = pickups[0]!;
  assertEqual(chest.kind, "chest", `the kind of the ${type}'s pickup`);
  assertNear(chest.x, KILL_AT.x, POSITION_TOL, `the ${type}'s chest's x`);
  assertNear(chest.y, KILL_AT.y, POSITION_TOL, `the ${type}'s chest's y`);
  assertEqual(
    newGems(death.before, death.after).length,
    0,
    `the gems the ${type}'s death dropped`,
  );
}

/** The posed enemy is gone from the tick that killed it, or the point fails. */
export function assertDead(death: Death, type: EnemyId): void {
  assertUndefined(
    enemyById(death.after, death.posed.id),
    `the ${type} in the snapshot of the tick the bolt hit on`,
  );
}

/**
 * The heading of `enemy` as a point, or the point fails: a snapshot that
 * reports no heading reports no behavior either.
 */
export function headingOf(enemy: EnemyView): XY {
  const heading = enemy.heading as XY | undefined;
  if (
    heading === undefined ||
    typeof heading.x !== "number" ||
    typeof heading.y !== "number"
  ) {
    fail(`a heading on enemy ${enemy.id}`, enemy.heading);
  }
  return { x: heading.x, y: heading.y };
}
