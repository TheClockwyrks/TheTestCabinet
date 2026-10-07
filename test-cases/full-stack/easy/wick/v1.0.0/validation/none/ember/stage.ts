// ember/stage — what the Ember checks share: the targets a firing is posed
// against, the bolts a firing tick created and where each was aimed, and the
// one row check the eight `row-N` points each run against their own row of
// `EMBER_LEVELS`.
//
// THE TARGETS. `specs/weapons.md` ("Ember"): "A bolt is a circle of `radius`,
// fired from the player's center at `speed` in the direction of the nearest
// enemy's center on the tick of firing", and "With amount `n`, `n` bolts fire
// on the same tick, one at each of the `n` nearest distinct enemies". So a
// firing needs as many live enemies as its amount, and each check here poses
// moths for the bolts to aim at. A moth is the target because it is the
// smallest enemy (`radius` `10`, `specs/enemies.md`), and every target stands
// on a ring `TARGET_RING` (`200`) units out: "Two circles overlap when the
// distance between their centers is less than the sum of their radii"
// (`specs/weapons.md`, "Shapes and overlap"), and a bolt "hitting at the
// position it was created at" (`specs/world.md`, phase 6) sits at the
// lamplighter's center, `200` from every target against the largest sum of
// radii, `10 + 10` at level 8, so no bolt hits on its own tick and every bolt
// is in the snapshot the firing tick leaves.
//
// THE FIRING. `specs/weapons.md` ("Cooldown timers"): "On acquisition the
// timer is `0`, so a weapon fires on the first `playing` tick it is held", and
// the harness's `fireWeapon` is exactly that: hold Ember at the level, arm it,
// turn `weaponFire` on, step one tick. Everything else stays held, so the tick
// counts one timer and fires one weapon; `enemyMotion` is off, so every target
// stands where it was posed on the firing tick, and `effectMotion` is off, so
// each bolt stands at the center it was created at with the velocity the
// firing gave it ("Every projectile holds its position and velocity",
// `specs/instrumentation.md`).
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, assertTrue, fail } from "../assert";
import {
  FLOAT_TOL,
  POSITION_TOL,
  TIMER_TOL,
  type ProjectileWeapon,
  weaponRow,
} from "../constants";
import {
  alongAngle,
  captureStill,
  directionToward,
  fireWeapon,
  isolate,
  placeEnemy,
  unitToward,
  type EnemyView,
  type Firing,
  type Harness,
  type ProjectileView,
  type WickSnapshot,
  type XY,
} from "../harness";

/** The weapon every check here is about. */
export const EMBER: ProjectileWeapon = "ember";

/** How far out the ring of targets stands: clear of a bolt at the center. */
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

/** Place one moth at each of `points`, in order, and answer them as posed. */
export async function placeMoths(
  h: Harness,
  points: readonly XY[],
): Promise<EnemyView[]> {
  const moths: EnemyView[] = [];
  for (const point of points) {
    moths.push(await placeEnemy(h, "moth", point.x, point.y));
  }
  return moths;
}

/** The Ember bolts among the projectiles `firing` created, in id order. */
export function boltsOf(firing: Firing): ProjectileView[] {
  return firing.projectiles.filter((shape) => shape.weapon === EMBER);
}

/**
 * The unit direction of `bolt`'s velocity, or the point fails: a bolt with no
 * velocity was aimed at nothing.
 */
export function boltDirection(bolt: ProjectileView): XY {
  const heading = unitToward(CENTER, { x: bolt.vx, y: bolt.vy });
  if (heading === null) {
    fail(`bolt ${bolt.id} with a non-zero velocity`, {
      vx: bolt.vx,
      vy: bolt.vy,
    });
  }
  return heading;
}

/**
 * Whether `bolt` was aimed at `target`: its direction is within `FLOAT_TOL`
 * on each component of "the unit vector from the player's center to the
 * enemy's center" read off `before`, the state the firing tick fired from.
 */
export function aimedAt(
  before: WickSnapshot,
  bolt: ProjectileView,
  target: XY,
): boolean {
  const heading = boltDirection(bolt);
  const wanted = directionToward(before, target);
  return (
    Math.abs(heading.x - wanted.x) <= FLOAT_TOL &&
    Math.abs(heading.y - wanted.y) <= FLOAT_TOL
  );
}

/**
 * `bolt` leaves the lamplighter's center toward `target`: created at the
 * player's center of `before` within `POSITION_TOL`, with its velocity's unit
 * direction within `FLOAT_TOL` of the direction toward `target`.
 */
export function assertAimed(
  before: WickSnapshot,
  bolt: ProjectileView,
  target: XY,
  what: string,
): void {
  const at = before.run.player;
  assertNear(bolt.x, at.x, POSITION_TOL, `${what}: the bolt's x at creation`);
  assertNear(bolt.y, at.y, POSITION_TOL, `${what}: the bolt's y at creation`);
  const heading = boltDirection(bolt);
  const wanted = directionToward(before, target);
  assertNear(
    heading.x,
    wanted.x,
    FLOAT_TOL,
    `${what}: the bolt's direction, x`,
  );
  assertNear(
    heading.y,
    wanted.y,
    FLOAT_TOL,
    `${what}: the bolt's direction, y`,
  );
}

/**
 * Every target in `targets` has exactly one of `bolts` aimed at it, and every
 * bolt is aimed at one of them: what "one at each of the `n` nearest distinct
 * enemies" reads as, without fixing which bolt id went to which target.
 */
export function assertOneBoltPerTarget(
  before: WickSnapshot,
  bolts: readonly ProjectileView[],
  targets: readonly XY[],
  what: string,
): void {
  assertEqual(bolts.length, targets.length, `${what}: bolts for the targets`);
  const claimed = new Set<number>();
  for (const [index, target] of targets.entries()) {
    const aimed = bolts.filter((bolt) => aimedAt(before, bolt, target));
    assertEqual(
      aimed.length,
      1,
      `${what}: bolts aimed at target ${index} at (${target.x}, ${target.y})`,
    );
    claimed.add(aimed[0]!.id);
  }
  assertEqual(
    claimed.size,
    bolts.length,
    `${what}: distinct bolts, one per target`,
  );
}

/**
 * The `row-N` check: hold Ember at `level` on an isolated night with as many
 * moths on the ring as the row's amount, run the tick it fires on, write the
 * `row` still, and assert what row `level` of `EMBER_LEVELS` gives the firing.
 *
 * `specs/weapons.md` ("Ember"): "A bolt is a circle of `radius`, fired from
 * the player's center at `speed` ... removed after `duration` seconds. Its
 * pierce is the table `pierce`", and "With amount `n`, `n` bolts fire on the
 * same tick"; ("Derived stats") the radius is the "table value × `areaMul`"
 * and the damage the "table value × `damageMul`", both `1` with no passive
 * held, and "Speed, Pierce, Duration" the "table value, unchanged";
 * ("Projectiles and pierce") "A projectile's `ttl` is set to its `duration`
 * when it is fired"; ("Cooldown timers") "After firing, the timer is set to
 * the weapon's current cooldown", "the table cooldown times `cooldownMul`",
 * so the slot reads the table cooldown on the firing tick.
 * `specs/instrumentation.md` ("Snapshot shape") has `damage` as "the damage
 * per hit the shape carries".
 *
 * TOLERANCE. `FLOAT_TOL` on the radius and the damage, each a table figure
 * times `1`, and on the speed, the magnitude of a velocity a build computed
 * as the speed times a unit vector; `TIMER_TOL` on the ttl and on the timer
 * the firing set. The bolt count and the pierce are exact.
 */
export async function checkEmberRow(h: Harness, level: number): Promise<void> {
  const row = weaponRow(EMBER, level);
  const amount = row.amount ?? 0;
  assertTrue(amount > 0, `a positive amount in row ${level} of EMBER_LEVELS`);

  await isolate(h);
  await placeMoths(h, ringPoints(amount));
  const firing = await fireWeapon(h, EMBER, level);
  await captureStill(h, "row");

  const bolts = boltsOf(firing);
  assertEqual(
    bolts.length,
    amount,
    `Ember bolts the level-${level} firing tick created with ${amount} enemies alive`,
  );
  for (const bolt of bolts) {
    assertNear(
      bolt.radius,
      row.radius ?? NaN,
      FLOAT_TOL,
      `bolt ${bolt.id}'s radius at level ${level}`,
    );
    assertNear(
      bolt.damage,
      row.damage,
      FLOAT_TOL,
      `bolt ${bolt.id}'s damage at level ${level}`,
    );
    assertNear(
      Math.hypot(bolt.vx, bolt.vy),
      row.speed ?? NaN,
      FLOAT_TOL,
      `bolt ${bolt.id}'s speed at level ${level}`,
    );
    assertEqual(
      bolt.pierce,
      row.pierce,
      `bolt ${bolt.id}'s pierce at level ${level}`,
    );
    assertNear(
      bolt.ttl,
      row.duration ?? NaN,
      TIMER_TOL,
      `bolt ${bolt.id}'s ttl at level ${level}`,
    );
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, EMBER, "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    row.cooldown ?? NaN,
    TIMER_TOL,
    `Ember's timer after the level-${level} firing`,
  );
}
