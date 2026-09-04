// spark/strike — what the points of this category share: an isolated night
// holding Spark alone at a level with its firing due on the next tick, the
// enemies it may strike posed around the lamplighter, and the readings of the
// strikes the firing tick created against the row of `SPARK_LEVELS` in force.
// CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/weapons.md ("Spark", "Shapes and overlap", "Hits and death", "Derived
// stats", and "Cooldown timers") that several points assert the same way.
//
// WHAT A STRIKE IS READ BY. "On firing, `amount` strikes land, each on a
// distinct enemy chosen uniformly at random among the live enemies within
// `SPARK_RANGE` (`600`) of the player's center" (specs/weapons.md, "Spark"),
// and a strike is a zone whose "`x`, `y`" is "the center of the circle"
// (specs/state.md, `ZoneState`), that circle being centered on its target. So
// a strike is told to have landed on a posed enemy by its center coinciding
// with that enemy's center as the build itself reported it before the tick.
//
// WHY TWO KINDS OF ENEMY. A moth is a circle of radius 10 with HP 5
// (specs/enemies.md), the smallest common enemy, and every Spark row deals at
// least 15, so a moth a strike hit is GONE after the tick and a moth a strike
// missed stands with its hp exactly as it was; the points about WHICH enemies
// a strike reaches read that. A hound has HP 120, more than the heaviest row's
// 40, so a hound a strike hit stands with its hp lower by exactly the strike's
// damage; the row points read that figure.
//
// WHY THESE PLACES. Every posed target lies within `SPARK_RANGE` of the
// lamplighter's center and no two lie within `70` of each other, the largest
// `area` any row states, so a strike on one target reaches no other and each
// target's hp after the tick is its own strike's doing alone.

import { assertEqual, assertWithin, fail } from "../assert";
import {
  FIGURE_TOLERANCE,
  SPARK_LEVELS,
  cooldownFor,
  derived,
  type EnemyId,
  type StrikeRow,
} from "../constants";
import {
  armWeapon,
  enemyById,
  holdWeapon,
  isolate,
  present,
  spawnEnemyNear,
  zonesOf,
  type Harness,
  type Point,
  type WickSnapshot,
  type ZoneSnapshot,
} from "../harness";

/** The enemy the points about reach and splash pose: HP 5, radius 10. */
export const PROBE: EnemyId = "moth";

/** The enemy the row points pose: HP 120, which outlasts any row's damage. */
export const DURABLE: EnemyId = "hound";

/**
 * Where a posed target stands, as an offset from the lamplighter's center, in
 * the order they are spawned: about 150, 200, 269, 316, and 430 units out,
 * every one within `SPARK_RANGE` (600), and no two within 250 of each other,
 * beyond the largest `area` any row states (70). There are five because the
 * row points pose one more enemy than the row's amount, so a build whose
 * amount is above the table has somewhere to put the surplus strike.
 */
export const TARGET_OFFSETS: readonly Point[] = [
  { x: 150, y: 0 },
  { x: 0, y: -200 },
  { x: -250, y: 100 },
  { x: 100, y: 300 },
  { x: -350, y: -250 },
];

/** The first `count` of {@link TARGET_OFFSETS}. */
export function targetsFor(count: number): readonly Point[] {
  return TARGET_OFFSETS.slice(0, count);
}

/** One posed target: its id, its center as the build reported it, and its hp. */
export interface Target {
  id: number;
  at: Point;
  hp: number;
}

/** What {@link armSpark} posed: the slot Spark took and the enemies around it. */
export interface Volley {
  slot: number;
  targets: Target[];
  /** The lamplighter's center on the posed tick. */
  player: Point;
  /** The night as posed, before the firing tick. */
  posed: WickSnapshot;
}

/**
 * Reset to an isolated night holding Spark alone at `level`, one enemy of
 * `type` at each of `offsets` from the lamplighter's center, with Spark's
 * timer at 0 and `weaponFire` on, so the next `playing` tick is the firing
 * tick: "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (specs/instrumentation.md). Every other switch stays off: `enemyMotion` off
 * holds each enemy where it was posed, so the distances the firing tick reads
 * are the posed ones and a strike's center is a posed center; `enemyContact`
 * off keeps an enemy from touching the lamplighter; nothing else on the night
 * can create a zone or change an enemy's hp.
 */
export function armSpark(
  h: Harness,
  level: number,
  offsets: readonly Point[],
  type: EnemyId = PROBE,
): Volley {
  isolate(h);
  const player = { ...h.snapshot().run.player };
  const targets: Target[] = offsets.map((offset) => {
    const id = spawnEnemyNear(h, type, offset.x, offset.y);
    const placed = present(enemyById(h.snapshot(), id), `the posed ${type}`);
    return { id, at: { x: placed.x, y: placed.y }, hp: placed.hp };
  });
  const slot = holdWeapon(h, "spark", level);
  armWeapon(h, slot);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "spark", "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, level, "Spark's posed level");
  assertEqual(posed.run.weapons[slot]?.cooldown, 0, "Spark's posed timer");
  assertEqual(posed.weaponFire, true, "weaponFire before the firing tick");
  assertEqual(
    posed.run.enemies.length,
    offsets.length,
    "enemies alive before the firing tick",
  );
  assertEqual(
    zonesOf(posed, "spark").length,
    0,
    "strikes before the firing tick",
  );
  return { slot, targets, player: { x: player.x, y: player.y }, posed };
}

/** Row `level` of SPARK_LEVELS: "row `i` is level `i + 1`" (specs/weapons.md). */
export function sparkRow(level: number): StrikeRow {
  return SPARK_LEVELS[level - 1];
}

/** Every Spark strike in `snapshot`, ascending by id. */
export function strikesIn(snapshot: WickSnapshot): ZoneSnapshot[] {
  return zonesOf(snapshot, "spark").filter((zone) => zone.kind === "strike");
}

/** Whether `strike`'s center is `at`, within `FIGURE_TOLERANCE` on each axis. */
export function centeredOn(strike: ZoneSnapshot, at: Point): boolean {
  return (
    Math.abs(strike.x - at.x) <= FIGURE_TOLERANCE &&
    Math.abs(strike.y - at.y) <= FIGURE_TOLERANCE
  );
}

/** Every strike of `strikes` centered on `target`, ascending by id. */
export function strikesOn(
  strikes: readonly ZoneSnapshot[],
  target: Target,
): ZoneSnapshot[] {
  return strikes.filter((strike) => centeredOn(strike, target.at));
}

/**
 * The index in `targets` of the one `strike` is centered on, or the item
 * failed: a strike centered on no posed enemy landed on nothing the spec lets
 * it land on.
 */
export function targetOf(
  strike: ZoneSnapshot,
  targets: readonly Target[],
  context: string,
): number {
  const index = targets.findIndex((target) => centeredOn(strike, target.at));
  if (index < 0) {
    fail(
      `a strike centered on one of the posed enemies at ${JSON.stringify(
        targets.map((target) => target.at),
      )} (${context})`,
      { x: strike.x, y: strike.y },
    );
  }
  return index;
}

/**
 * `strike` carries the figures `row` gives a strike created with no passive
 * held: radius `row.area × areaMul` ("a strike's `radius` is its `area`",
 * specs/weapons.md, "Shapes and overlap") and damage `row.damage × damageMul`
 * ("Derived stats"). With nothing held every multiplier is `1`
 * (specs/passives.md).
 */
export function assertStrikeOfRow(
  strike: ZoneSnapshot,
  row: StrikeRow,
  context: string,
): void {
  assertWithin(
    strike.radius,
    row.area * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: radius, its area`,
  );
  assertWithin(
    strike.damage,
    row.damage * derived.damageMul({}),
    FIGURE_TOLERANCE,
    `${context}: damage`,
  );
}

/**
 * Spark's timer in `slot` reads `row`'s cooldown after the firing tick: "After
 * firing, the timer is set to the weapon's current cooldown", which "is the
 * table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`"
 * (specs/weapons.md, "Cooldown timers"), `1` times the table figure with no
 * Oil held.
 */
export function assertTimerOfRow(
  after: WickSnapshot,
  slot: number,
  row: StrikeRow,
): void {
  assertWithin(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    cooldownFor(row.cooldown, {}),
    FIGURE_TOLERANCE,
    "Spark's timer after the firing tick",
  );
}

/**
 * The firing tick of `volley`, posed with one more durable target than `row`'s
 * amount, created exactly `row.amount` strikes, each of `row`, each on a
 * distinct posed enemy, each removing `row`'s damage from the enemy it landed
 * on, and left every posed enemy no strike reached standing untouched:
 * "`amount` strikes land, each on a distinct enemy chosen uniformly at random
 * among the live enemies within `SPARK_RANGE` (`600`) of the player's center"
 * (specs/weapons.md, "Spark"), and "A hit removes the shape's damage per hit
 * from the enemy's `hp`" ("Hits and death").
 *
 * WHY ONE MORE TARGET THAN THE AMOUNT. With exactly as many enemies as the
 * amount, a build whose amount is above the table can land no more strikes
 * than there are enemies to land them on, so the count read back is the pose's
 * rather than the build's. One spare enemy leaves the surplus strike somewhere
 * to go, and every assertion here is independent of which enemies the uniform
 * choice named, so the reading stays a decision rather than a sample: the
 * count, the distinctness, the figures on each strike, the hp removed from
 * each struck enemy, and the untouched hp of each enemy left over.
 */
export function assertVolleyOfRow(
  volley: Volley,
  after: WickSnapshot,
  row: StrikeRow,
): void {
  const strikes = strikesIn(after);
  assertEqual(
    strikes.length,
    row.amount,
    "Spark strikes after the firing tick",
  );
  const struck = strikes.map((strike, index) =>
    targetOf(
      strike,
      volley.targets,
      `the strike ${index + 1} of ${strikes.length}`,
    ),
  );
  assertEqual(
    new Set(struck).size,
    struck.length,
    "posed enemies the strikes landed on, counted without repeats",
  );
  strikes.forEach((strike, index) => {
    const target = volley.targets[struck[index]];
    const which = `the strike on the posed enemy ${struck[index] + 1} of ${
      volley.targets.length
    }`;
    assertStrikeOfRow(strike, row, which);
    const hit = present(enemyById(after, target.id), `${which}: its target`);
    assertWithin(
      hit.hp,
      target.hp - row.damage * derived.damageMul({}),
      FIGURE_TOLERANCE,
      `${which}: its target's hp after the strike`,
    );
  });
  volley.targets.forEach((target, index) => {
    if (struck.includes(index)) return;
    assertUnhurt(
      volley.posed,
      after,
      target.id,
      `the posed enemy ${index + 1} of ${volley.targets.length}, which no strike landed on`,
    );
  });
}

/**
 * The enemy `id` took a hit on the ticks between `before` and `after`: it is
 * gone, having died on the tick, or its hp is lower than it was.
 */
export function assertStruck(
  before: WickSnapshot,
  after: WickSnapshot,
  id: number,
  context: string,
): void {
  const was = enemyById(before, id);
  if (was === undefined) fail(`the posed enemy (${context})`, "not posed");
  const now = enemyById(after, id);
  if (now === undefined || now.hp < was.hp) return;
  fail(`the enemy gone, or its hp below ${was.hp} (${context})`, now.hp);
}

/**
 * The enemy `id` took no hit on the ticks between `before` and `after`: it
 * stands with its hp exactly as it was, since nothing else on the posed night
 * can touch it.
 */
export function assertUnhurt(
  before: WickSnapshot,
  after: WickSnapshot,
  id: number,
  context: string,
): void {
  const was = enemyById(before, id);
  if (was === undefined) fail(`the posed enemy (${context})`, "not posed");
  const now = enemyById(after, id);
  if (now === undefined) {
    fail(`the enemy present with hp ${was.hp} (${context})`, "gone");
  }
  assertEqual(now.hp, was.hp, `${context}: hp`);
}
