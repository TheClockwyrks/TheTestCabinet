// spark/stage — what the Spark checks share: the targets a firing is posed
// against, the strike zones a firing tick created and which target each
// landed on, the reading of what a strike did to a posed enemy, and the one
// row check the eight `row-N` points each run against their own row of
// `SPARK_LEVELS`.
//
// THE TARGETS. `specs/weapons.md` ("Spark"): "On firing, `amount` strikes
// land, each on a distinct enemy chosen uniformly at random among the live
// enemies within `SPARK_RANGE` (`600`) of the player's center, fewer when
// fewer such enemies exist", and ("Shapes and overlap") "An enemy is within
// `d` of a point when the distance from that point to the enemy's center is
// at most `d`". A strike "deals `damage` to its target and to every other
// enemy within `area` of the target's center", so every target a check poses
// stands on a ring `TARGET_RING` (`200`) units out, evenly spaced, so with the
// most targets any row needs, four at `90` degrees, each is `283` units from
// its nearest neighbour against the largest area, `70` at level 8: no strike's
// splash reaches a second target, and every target is well inside the range.
//
// WHICH TARGET WAS STRUCK is read off the zone: `specs/weapons.md` ("Shapes
// and overlap") "Every zone's position is the center of its shape; a strike's
// `radius` is its `area`", and the strike covers "every other enemy within
// `area` of the target's center", so a strike zone is centered on the target
// it landed on. A zone matches a posed target when its center is within
// `POSITION_TOL` of the target's posed center, a copy rather than an
// integration.
//
// THE PROBE. A check that asks whether an enemy was hit reads what the firing
// tick did to it: `specs/weapons.md` ("Hits and death") "A hit removes the
// shape's damage per hit from the enemy's `hp`", and "On any tick an enemy's
// `hp` is at or below `0` after the hits the enemy dies on that tick", so a
// struck enemy reads `hp` lower by exactly the damage when that leaves it
// above `0`, and is gone when it does not. A hound (`120` hp,
// `specs/enemies.md`, unscaled at a run clock of `0`) outlives Spark's largest
// damage, `40`, so the row checks read the removal exactly; a moth (`5` hp)
// dies of any strike, so a check that only asks whether an enemy was struck
// reads it as gone.
//
// THE FIRING. `specs/weapons.md` ("Cooldown timers"): "On acquisition the
// timer is `0`, so a weapon fires on the first `playing` tick it is held", and
// the harness's `fireWeapon` is exactly that: hold Spark at the level, arm it,
// turn `weaponFire` on, step one tick. Everything else stays held, so the tick
// counts one timer, fires one weapon, and resolves the hits of phase 6
// (`specs/world.md`, "One tick"). `enemyMotion` and `enemyContact` are off, so
// every target stands where it was posed on the firing tick and lands nothing.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, assertTrue, fail } from "../assert";
import {
  FLOAT_TOL,
  POSITION_TOL,
  TIMER_TOL,
  type BaseWeaponId,
  type EnemyId,
  weaponRow,
} from "../constants";
import {
  alongAngle,
  captureStill,
  enemyById,
  fireWeapon,
  isolate,
  placeEnemy,
  type EnemyView,
  type Harness,
  type WickSnapshot,
  type XY,
  type ZoneView,
} from "../harness";

/** The weapon every check here is about. */
export const SPARK: BaseWeaponId = "spark";

/** How far out the ring of targets stands: inside the range, clear of each other's splash. */
export const TARGET_RING = 200;

/** The lamplighter's center on an isolated night: the world origin. */
export const CENTER: XY = { x: 0, y: 0 };

/**
 * `count` points spread evenly around the lamplighter on the target ring,
 * the first along `+x`, so `count` targets stand at distinct directions and
 * one distance.
 */
export function ringPoints(count: number): XY[] {
  const points: XY[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push(alongAngle(CENTER, (360 * i) / count, TARGET_RING));
  }
  return points;
}

/** Place one enemy of `type` at each of `points`, in order, and answer them as posed. */
export async function placeTargets(
  h: Harness,
  type: EnemyId,
  points: readonly XY[],
): Promise<EnemyView[]> {
  const targets: EnemyView[] = [];
  for (const point of points) {
    targets.push(await placeEnemy(h, type, point.x, point.y));
  }
  return targets;
}

/** The Spark strikes among `zones`, in id order. */
export function strikesOf(zones: readonly ZoneView[]): ZoneView[] {
  return zones
    .filter((zone) => zone.kind === "strike" && zone.weapon === SPARK)
    .sort((a, b) => a.id - b.id);
}

/** Whether `zone` is centered on `target`, within `POSITION_TOL` on each axis. */
export function centeredOn(zone: ZoneView, target: XY): boolean {
  return (
    Math.abs(zone.x - target.x) <= POSITION_TOL &&
    Math.abs(zone.y - target.y) <= POSITION_TOL
  );
}

/** The index into `targets` of the one `zone` is centered on, or `-1`. */
export function targetOf(zone: ZoneView, targets: readonly XY[]): number {
  return targets.findIndex((target) => centeredOn(zone, target));
}

/**
 * `zone` landed on `target`: its center is the target's posed center within
 * `POSITION_TOL` on each axis.
 */
export function assertCenteredOn(
  zone: ZoneView,
  target: XY,
  what: string,
): void {
  assertNear(zone.x, target.x, POSITION_TOL, `${what}: the strike's center x`);
  assertNear(zone.y, target.y, POSITION_TOL, `${what}: the strike's center y`);
}

/**
 * The enemy `posed` was struck for `damage` by the tick that left `after`:
 * its `hp` is lower by exactly `damage` when that leaves it above `0`, and it
 * is gone when it does not.
 */
export function assertStruck(
  after: WickSnapshot,
  posed: EnemyView,
  damage: number,
  what: string,
): void {
  const left = posed.hp - damage;
  const now = enemyById(after, posed.id);
  if (left <= 0) {
    if (now === undefined) return;
    fail(
      `${what}: ${posed.type} ${posed.id} dead of the strike (hp ${posed.hp} less ${damage})`,
      `present at hp ${now.hp}`,
    );
  }
  if (now === undefined) {
    fail(
      `${what}: ${posed.type} ${posed.id} present at hp ${left} (hp ${posed.hp} less ${damage})`,
      "gone",
    );
  }
  assertNear(
    now.hp,
    left,
    FLOAT_TOL,
    `${what}: ${posed.type} ${posed.id}'s hp`,
  );
}

/**
 * The enemy `posed` was left alone by the tick that left `after`: still live,
 * at exactly the hp it was posed with.
 */
export function assertUntouched(
  after: WickSnapshot,
  posed: EnemyView,
  what: string,
): void {
  const now = enemyById(after, posed.id);
  if (now !== undefined && now.hp === posed.hp) return;
  fail(
    `${what}: ${posed.type} ${posed.id} untouched (present at hp ${posed.hp})`,
    now === undefined ? "gone" : `present at hp ${now.hp}`,
  );
}

/**
 * Every target in `targets` has exactly one of `strikes` centered on it, and
 * every strike is centered on one of them: what "`amount` strikes land, each
 * on a distinct enemy" reads as, without fixing which zone id went to which
 * target.
 */
export function assertOneStrikePerTarget(
  strikes: readonly ZoneView[],
  targets: readonly XY[],
  what: string,
): void {
  assertEqual(
    strikes.length,
    targets.length,
    `${what}: strikes for the targets`,
  );
  const claimed = new Set<number>();
  for (const [index, target] of targets.entries()) {
    const landed = strikes.filter((zone) => centeredOn(zone, target));
    assertEqual(
      landed.length,
      1,
      `${what}: strikes centered on target ${index} at (${target.x}, ${target.y})`,
    );
    claimed.add(landed[0]!.id);
  }
  assertEqual(
    claimed.size,
    strikes.length,
    `${what}: distinct strikes, one per target`,
  );
}

/**
 * The `row-N` check: hold Spark at `level` on an isolated night with as many
 * hounds on the ring as the row's amount, run the tick it fires on, write the
 * `row` still, and assert what row `level` of `SPARK_LEVELS` gives the firing.
 *
 * `specs/weapons.md` ("Spark"): "On firing, `amount` strikes land, each on a
 * distinct enemy ... within `SPARK_RANGE`", "A strike deals `damage` to its
 * target ... on the tick it lands"; ("Shapes and overlap") "a strike's
 * `radius` is its `area`"; ("Derived stats") the area is the "table value ×
 * `areaMul`" and the damage the "table value × `damageMul`", both `1` with no
 * passive held, and the amount the "table value + `amountBonus`", `0` with no
 * Lure held (`specs/passives.md`); ("Hits and death") "A hit removes the
 * shape's damage per hit from the enemy's `hp`"; ("Cooldown timers") "After
 * firing, the timer is set to the weapon's current cooldown", "the table
 * cooldown times `cooldownMul`", so the slot reads the table cooldown on the
 * firing tick. `specs/instrumentation.md` ("Snapshot shape") has `damage` as
 * "the damage per hit the shape carries".
 *
 * TOLERANCE. `FLOAT_TOL` on the radius and the damage, each a table figure
 * times `1`, and on a hound's hp, a posed figure less a table figure;
 * `POSITION_TOL` on each strike's center against its target's posed center;
 * `TIMER_TOL` on the timer the firing set. The strike count is exact.
 */
export async function checkSparkRow(h: Harness, level: number): Promise<void> {
  const row = weaponRow(SPARK, level);
  const amount = row.amount ?? 0;
  assertTrue(amount > 0, `a positive amount in row ${level} of SPARK_LEVELS`);

  await isolate(h);
  const hounds = await placeTargets(h, "hound", ringPoints(amount));
  const firing = await fireWeapon(h, SPARK, level);
  await captureStill(h, "row");

  const strikes = strikesOf(firing.zones);
  assertEqual(
    strikes.length,
    amount,
    `Spark strike zones the level-${level} firing tick created with ${amount} enemies in range`,
  );
  for (const strike of strikes) {
    assertNear(
      strike.radius,
      row.area ?? NaN,
      FLOAT_TOL,
      `strike ${strike.id}'s radius at level ${level}`,
    );
    assertNear(
      strike.damage,
      row.damage,
      FLOAT_TOL,
      `strike ${strike.id}'s damage at level ${level}`,
    );
  }
  assertOneStrikePerTarget(strikes, hounds, `the level-${level} firing`);
  for (const hound of hounds) {
    assertStruck(firing.after, hound, row.damage, `the level-${level} firing`);
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, SPARK, "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    row.cooldown ?? NaN,
    TIMER_TOL,
    `Spark's timer after the level-${level} firing`,
  );
}
