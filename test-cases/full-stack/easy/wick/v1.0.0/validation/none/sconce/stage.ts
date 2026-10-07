// sconce/stage — what the Sconce checks share: the targets a firing is posed
// against, the sconces a firing tick created, a sconce posed on a launch
// direction of its own, the arithmetic of a decelerating flight, and the one
// row check the eight `row-N` points each run against their own row of
// `SCONCE_LEVELS`.
//
// THE FIRING. `specs/weapons.md` ("Sconce"): "A sconce is a circle of
// `radius`, launched from the player's center at `speed` along the launch
// direction `d`, the direction of the nearest enemy on the tick of firing.
// Sconce needs at least one enemy to fire." ("Cooldown timers"): "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick
// it is held", and the harness's `fireWeapon` is exactly that: hold Sconce at
// the level, arm it, turn `weaponFire` on, step one tick. Everything else
// stays held, so the tick counts one timer and fires one weapon; `enemyMotion`
// is off, so every target stands where it was posed on the firing tick, and
// `effectMotion` is off, so each sconce stands at the center it was created at
// with the velocity and the acceleration the launch gave it ("Every projectile
// holds its position and velocity", `specs/instrumentation.md`).
//
// THE TARGETS. A moth is the target because it is the smallest enemy (`radius`
// `10`, `specs/enemies.md`), and every target stands on a ring `TARGET_RING`
// (`500`) units out. A sconce launched at `600` and slowed at `SCONCE_DECEL`
// (`600`) turns back after one second, having travelled `305` units
// ({@link reachAfter}), so a target on the ring is beyond the whole reach of
// any sconce these checks launch, whether the sconces are held still or let
// fly: no target is ever hit, no target ever dies, and the sconces a firing
// created are all still in the snapshot the tick left.
//
// THE FLIGHT. `specs/weapons.md` ("Sconce"): its velocity along `d` "falls
// under a constant acceleration of `−SCONCE_DECEL` (`600`) units per second
// squared, integrated per tick as Projectiles and pierce states, position
// first and then velocity, so after `n` moving ticks its velocity is
// `(speed − SCONCE_DECEL × n × TICK_DT) × d`"; `specs/world.md` (phase 6)
// moves a projectile only "while `effectMotion` is on". So a check about the
// flight poses a sconce, turns `effectMotion` on alone, and counts ticks:
// {@link speedAfter} is the speed along `d` after `n` of them and
// {@link reachAfter} the distance travelled along `d`, the running sum of the
// speed each tick moved at times `TICK_DT`.
//
// A POSED SCONCE IS THE ISOLATED WORLD a flight check wants: one shape, no
// enemy, no weapon held. `specs/instrumentation.md` (`spawnProjectile`) gives
// it the same figures a launch would — "A `sconce` takes acceleration
// `−SCONCE_DECEL` along the unit vector of `(vx, vy)`" and, with Sconce
// unheld, row 1's radius, damage, and duration — so the rule the flight checks
// read is in force on it exactly as on a launched one. Its direction is `+x`
// ({@link LAUNCH_LINE}), where the expected vectors are exact and the
// specification fixes no axis of its own.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, assertTrue } from "../assert";
import {
  FLOAT_TOL,
  INFINITE_PIERCE,
  SCONCE_DECEL,
  TICK_DT,
  TIMER_TOL,
  type ProjectileWeapon,
  weaponRow,
} from "../constants";
import {
  alongAngle,
  captureStill,
  fireWeapon,
  isolate,
  placeEnemy,
  placeProjectile,
  type EnemyView,
  type Firing,
  type Harness,
  type ProjectileView,
  type XY,
} from "../harness";

/** The weapon every check here is about. */
export const SCONCE: ProjectileWeapon = "sconce";

/** The speed row 1 of `SCONCE_LEVELS` launches at, `600`. */
export const LAUNCH_SPEED = weaponRow(SCONCE, 1).speed!;

/** The lamplighter's center on an isolated night: the world origin. */
export const CENTER: XY = { x: 0, y: 0 };

/** The launch direction a posed sconce is given: `+x`, where the vectors are exact. */
export const LAUNCH_LINE: XY = { x: 1, y: 0 };

/** How far out the ring of targets stands: beyond a sconce's whole reach. */
export const TARGET_RING = 500;

/**
 * The speed along `d` after `ticks` moving ticks:
 * "`speed − SCONCE_DECEL × n × TICK_DT`" (`specs/weapons.md`, "Sconce"),
 * negative once the sconce has turned back.
 */
export function speedAfter(ticks: number): number {
  return LAUNCH_SPEED - SCONCE_DECEL * ticks * TICK_DT;
}

/**
 * How far along `d` the sconce has travelled after `ticks` moving ticks.
 *
 * `specs/world.md` (phase 6): "a projectile's position advances by its
 * velocity times `TICK_DT`, then its velocity changes by its acceleration
 * times `TICK_DT`". So tick `k`, counted from `1`, moves at the speed the
 * previous `k − 1` ticks left, and the distance is that sum. Negative once
 * the sconce has returned past its launch point.
 */
export function reachAfter(ticks: number): number {
  let reach = 0;
  for (let k = 0; k < ticks; k += 1) reach += speedAfter(k) * TICK_DT;
  return reach;
}

/** The component of `v` along the unit direction `d`. */
export function along(v: XY, d: XY): number {
  return v.x * d.x + v.y * d.y;
}

/** The component of `v` across `d`, `d` rotated a quarter turn toward `+y`. */
export function across(v: XY, d: XY): number {
  return v.x * -d.y + v.y * d.x;
}

/**
 * `count` points spread evenly around the lamplighter on the target ring, the
 * first along `+x`.
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

/** The Sconce projectiles among the ones `firing` created, in id order. */
export function sconcesOf(firing: Firing): ProjectileView[] {
  return firing.projectiles.filter((shape) => shape.weapon === SCONCE);
}

/**
 * Pose one sconce at `at`, launched along the unit direction `direction` at
 * `speed`, with the infinite pierce every sconce carries, and answer it as the
 * snapshot reports it.
 */
export function placeSconce(
  h: Harness,
  at: XY,
  direction: XY,
  speed: number = LAUNCH_SPEED,
): Promise<ProjectileView> {
  return placeProjectile(
    h,
    SCONCE,
    at.x,
    at.y,
    speed * direction.x,
    speed * direction.y,
    INFINITE_PIERCE,
  );
}

/**
 * The `row-N` check: hold Sconce at `level` on an isolated night with as many
 * moths on the ring as the row's amount, run the tick it launches on, write
 * the `row` still, and assert what row `level` of `SCONCE_LEVELS` gives the
 * firing.
 *
 * `specs/weapons.md` ("Sconce"): "A sconce is a circle of `radius`, launched
 * from the player's center at `speed` ... Its pierce is `INFINITE_PIERCE` ...
 * and it is removed after `duration` seconds", and "Amount `n` launches `n`
 * sconces on the same tick"; ("Derived stats") the radius is the "table value
 * × `areaMul`" and the damage the "table value × `damageMul`", both `1` with
 * no passive held, and "Speed, Pierce, Duration" the "table value, unchanged";
 * ("Projectiles and pierce") "A projectile's `ttl` is set to its `duration`
 * when it is fired"; ("Cooldown timers") "After firing, the timer is set to
 * the weapon's current cooldown", "the table cooldown times `cooldownMul`",
 * so the slot reads the table cooldown on the firing tick.
 * `specs/instrumentation.md` ("Snapshot shape") has `damage` as "the damage
 * per hit the shape carries".
 *
 * TOLERANCE. `FLOAT_TOL` on the radius and the damage, each a table figure
 * times `1`, and on the speed, the magnitude of a velocity a build computed as
 * the speed times a unit vector; `TIMER_TOL` on the ttl and on the timer the
 * firing set. The sconce count and the pierce are exact.
 */
export async function checkSconceRow(h: Harness, level: number): Promise<void> {
  const row = weaponRow(SCONCE, level);
  const amount = row.amount ?? 0;
  assertTrue(amount > 0, `a positive amount in row ${level} of SCONCE_LEVELS`);

  await isolate(h);
  await placeMoths(h, ringPoints(amount));
  const firing = await fireWeapon(h, SCONCE, level);
  await captureStill(h, "row");

  const sconces = sconcesOf(firing);
  assertEqual(
    sconces.length,
    amount,
    `Sconce projectiles the level-${level} firing tick created with ${amount} enemies alive`,
  );
  for (const sconce of sconces) {
    assertNear(
      sconce.radius,
      row.radius ?? NaN,
      FLOAT_TOL,
      `sconce ${sconce.id}'s radius at level ${level}`,
    );
    assertNear(
      sconce.damage,
      row.damage,
      FLOAT_TOL,
      `sconce ${sconce.id}'s damage at level ${level}`,
    );
    assertNear(
      Math.hypot(sconce.vx, sconce.vy),
      row.speed ?? NaN,
      FLOAT_TOL,
      `sconce ${sconce.id}'s speed at level ${level}`,
    );
    assertEqual(
      sconce.pierce,
      INFINITE_PIERCE,
      `sconce ${sconce.id}'s pierce at level ${level}`,
    );
    assertNear(
      sconce.ttl,
      row.duration ?? NaN,
      TIMER_TOL,
      `sconce ${sconce.id}'s ttl at level ${level}`,
    );
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, SCONCE, "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    row.cooldown ?? NaN,
    TIMER_TOL,
    `Sconce's timer after the level-${level} firing`,
  );
}
