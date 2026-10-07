// shard/stage — what the Shard checks share: the shards a firing tick created,
// a shard posed with infinite pierce for the bounce checks, the view's
// half-extents the bounce rectangle is built from, and the one row check the
// eight `row-N` points each run against their own row of `SHARD_LEVELS`.
//
// THE FIRING. `specs/weapons.md` ("Shard"): "A shard is a circle of `radius`,
// fired from the player's center at `speed` toward the nearest enemy, or in
// the facing direction when no enemy exists, so Shard fires whether or not any
// enemy exists. Its pierce is `INFINITE_PIERCE` ... and it is removed after
// `duration` seconds." ("Cooldown timers"): "On acquisition the timer is `0`,
// so a weapon fires on the first `playing` tick it is held", and the harness's
// `fireWeapon` is exactly that: hold Shard at the level, arm it, turn
// `weaponFire` on, step one tick. Everything else stays held, so the tick
// counts one timer and fires one weapon; `effectMotion` is off, so each shard
// stands at the center it was created at with the velocity the firing gave it
// ("Every projectile holds its position and velocity",
// `specs/instrumentation.md`). Shard needs no target, so a row check poses no
// enemy and every shard flies along the facing direction, hitting nothing.
//
// THE BOUNCE. `specs/weapons.md` ("Shard"): "While alive a shard stays inside
// the view: the `STAGE_W × STAGE_H` (`1280 × 720`) rectangle centered on the
// player's center on that tick, after the lamplighter has moved. After the
// shard's move on a tick, a center past an edge of that rectangle is clamped
// to that edge, and the velocity component across that edge reverses when it
// points outward". So the edges stand `STAGE_CX` (`640`) either side of the
// player's `x` and `STAGE_CY` (`360`) either side of the player's `y`, and a
// posed shard "first moves ... on the next tick" (`specs/instrumentation.md`)
// by "its velocity times `TICK_DT`" (`specs/world.md`, phase 6) on every tick
// `effectMotion` is on.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, assertTrue } from "../assert";
import {
  FLOAT_TOL,
  INFINITE_PIERCE,
  STAGE_CX,
  STAGE_CY,
  TICK_DT,
  TIMER_TOL,
  type ProjectileWeapon,
  weaponRow,
} from "../constants";
import {
  captureStill,
  fireWeapon,
  isolate,
  placeProjectile,
  type Firing,
  type Harness,
  type ProjectileView,
  type WickSnapshot,
  type XY,
} from "../harness";

/** The weapon every check here is about. */
export const SHARD: ProjectileWeapon = "shard";

/** The speed a posed shard flies at in the bounce checks: row 1's `500`. */
export const BOUNCE_SPEED = weaponRow(SHARD, 1).speed!;

/** How far a shard at `BOUNCE_SPEED` moves on one tick: `500 / 60` units. */
export const BOUNCE_STEP = BOUNCE_SPEED * TICK_DT;

/** The Shard projectiles among the ones `firing` created, in id order. */
export function shardsOf(firing: Firing): ProjectileView[] {
  return firing.projectiles.filter((shape) => shape.weapon === SHARD);
}

/**
 * The four edges of the view on `snapshot`: `player.x ± STAGE_CX` and
 * `player.y ± STAGE_CY` (`specs/world.md`, "The camera and the view").
 */
export function viewEdges(snapshot: WickSnapshot): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const at = snapshot.run.player;
  return {
    left: at.x - STAGE_CX,
    right: at.x + STAGE_CX,
    top: at.y - STAGE_CY,
    bottom: at.y + STAGE_CY,
  };
}

/**
 * Pose one shard at `at` with velocity `velocity` and infinite pierce, the
 * pierce every shard carries, and answer it as the snapshot reports it.
 */
export function placeShard(
  h: Harness,
  at: XY,
  velocity: XY,
): Promise<ProjectileView> {
  return placeProjectile(
    h,
    SHARD,
    at.x,
    at.y,
    velocity.x,
    velocity.y,
    INFINITE_PIERCE,
  );
}

/**
 * The `row-N` check: hold Shard at `level` on an isolated night with no
 * enemy, run the tick it fires on, write the `row` still, and assert what row
 * `level` of `SHARD_LEVELS` gives the firing.
 *
 * `specs/weapons.md` ("Shard"): "A shard is a circle of `radius`, fired from
 * the player's center at `speed` ... Its pierce is `INFINITE_PIERCE` ... and
 * it is removed after `duration` seconds", and "Amount `n` fires `n` shards
 * on the same tick"; ("Derived stats") the radius is the "table value ×
 * `areaMul`" and the damage the "table value × `damageMul`", both `1` with no
 * passive held, and "Speed, Pierce, Duration" the "table value, unchanged";
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
 * the firing set. The shard count and the pierce are exact.
 */
export async function checkShardRow(h: Harness, level: number): Promise<void> {
  const row = weaponRow(SHARD, level);
  const amount = row.amount ?? 0;
  assertTrue(amount > 0, `a positive amount in row ${level} of SHARD_LEVELS`);

  await isolate(h);
  const firing = await fireWeapon(h, SHARD, level);
  await captureStill(h, "row");

  const shards = shardsOf(firing);
  assertEqual(
    shards.length,
    amount,
    `Shard projectiles the level-${level} firing tick created`,
  );
  for (const shard of shards) {
    assertNear(
      shard.radius,
      row.radius ?? NaN,
      FLOAT_TOL,
      `shard ${shard.id}'s radius at level ${level}`,
    );
    assertNear(
      shard.damage,
      row.damage,
      FLOAT_TOL,
      `shard ${shard.id}'s damage at level ${level}`,
    );
    assertNear(
      Math.hypot(shard.vx, shard.vy),
      row.speed ?? NaN,
      FLOAT_TOL,
      `shard ${shard.id}'s speed at level ${level}`,
    );
    assertEqual(
      shard.pierce,
      INFINITE_PIERCE,
      `shard ${shard.id}'s pierce at level ${level}`,
    );
    assertNear(
      shard.ttl,
      row.duration ?? NaN,
      TIMER_TOL,
      `shard ${shard.id}'s ttl at level ${level}`,
    );
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, SHARD, "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    row.cooldown ?? NaN,
    TIMER_TOL,
    `Shard's timer after the level-${level} firing`,
  );
}
