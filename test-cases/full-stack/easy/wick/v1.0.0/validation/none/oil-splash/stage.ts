// oil-splash/stage — what the Oil Splash checks share: the puddles a firing
// tick created, a second firing of the weapon already held, the one row check
// the eight `row-N` points each run against their own row of
// `OIL_SPLASH_LEVELS`, and the firing that lands a puddle on a posed enemy.
//
// THE FIRING. `specs/weapons.md` ("Cooldown timers"): "On acquisition the
// timer is `0`, so a weapon fires on the first `playing` tick it is held;
// Taper, Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no target and
// fire the same way", and the harness's `fireWeapon` is exactly that: hold Oil
// Splash at the level, arm it, turn `weaponFire` on, step one tick. Everything
// else stays held, so the tick counts one timer and fires one weapon. A second
// firing on a later tick is `setWeaponCooldown(slot, 0)` and one more tick,
// since "a timer at `0` stays due on every tick until it is set again"
// (`specs/world.md`, "Timers").
//
// WHAT A FIRING CREATES. `specs/weapons.md` ("Oil Splash"): "On firing,
// `amount` puddles appear, each centered at an independent uniformly random
// point of the disk of radius `OIL_SCATTER` (`400`) about the player's
// center", and `specs/state.md` makes each a zone of kind `puddle`. So the
// puddles a tick created are the zones of that kind and weapon whose id is at
// least the `nextId` the run held before the tick.
//
// LANDING A PUDDLE ON AN ENEMY. Where a puddle lands is a random draw, so a
// check that needs an enemy under the puddle on the tick it appears poses the
// draw: `specs/instrumentation.md` ("Drawn outcomes"), `setNextPuddleOffset(dx,
// dy)`: "The first puddle the next Oil Splash or Blaze firing places lands at
// the lamplighter's center of that tick plus the offset". `fireOntoEnemy`
// poses the offset, stands the enemy at the point it names, and fires. A build
// whose firing lands elsewhere has broken that stated rule, and the point
// fails on it.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, assertTrue, fail } from "../assert";
import {
  FLOAT_TOL,
  OIL_SCATTER,
  POSITION_TOL,
  TIMER_TOL,
  weaponRow,
  type EnemyId,
  type PuddleWeapon,
} from "../constants";
import {
  armWeapon,
  captureStill,
  distanceBetween,
  fireWeapon,
  isolate,
  newZones,
  placeEnemy,
  type EnemyView,
  type Firing,
  type Harness,
  type WickSnapshot,
  type XY,
  type ZoneView,
} from "../harness";

/** The weapon every check here is about. */
export const OIL: PuddleWeapon = "oil-splash";

/**
 * The offset the posed puddle lands at, about the lamplighter's center: inside
 * the scatter disk, and far enough from the center that a puddle of the
 * largest table radius (`70`) about it clears the lamplighter's own circle.
 */
export const POSED_OFFSET: XY = { x: OIL_SCATTER / 2, y: -OIL_SCATTER / 4 };

/** The Oil Splash puddles among the zones `firing` created, in id order. */
export function puddlesOf(firing: Firing): ZoneView[] {
  return puddlesCreated(firing.before, firing.after);
}

/** The Oil Splash puddles `after` holds that `before` did not, in id order. */
export function puddlesCreated(
  before: WickSnapshot,
  after: WickSnapshot,
): ZoneView[] {
  return newZones(before, after).filter(
    (zone) => zone.kind === "puddle" && zone.weapon === OIL,
  );
}

/** Hold Oil Splash at `level` on an isolated night already posed, and run the tick it fires on. */
export function fireOil(h: Harness, level: number): Promise<Firing> {
  return fireWeapon(h, OIL, level);
}

/**
 * Fire the Oil Splash already held in `slot` once more: its timer to `0`, and
 * one tick with `weaponFire` as it stands. What a check that reads many
 * landings drives after {@link fireOil}.
 */
export async function refireOil(h: Harness, slot: number): Promise<Firing> {
  await armWeapon(h, slot);
  const before = await h.snapshot();
  const after = await h.step(1);
  return {
    slot,
    before,
    after,
    projectiles: [],
    zones: newZones(before, after),
  };
}

/** The center of `zone`, as a point. */
export function centerOf(zone: ZoneView): XY {
  return { x: zone.x, y: zone.y };
}

/** Whether two points are the same point, within `POSITION_TOL`. */
export function samePoint(a: XY, b: XY): boolean {
  return distanceBetween(a, b) <= POSITION_TOL;
}

/** The distinct points among `points`, each counted once within `POSITION_TOL`. */
export function distinctPoints(points: readonly XY[]): XY[] {
  const distinct: XY[] = [];
  for (const point of points) {
    if (!distinct.some((held) => samePoint(held, point))) distinct.push(point);
  }
  return distinct;
}

/** What {@link fireOntoEnemy} hands back. */
export interface Landing {
  /** The firing whose puddle landed on the enemy. */
  firing: Firing;
  /** The enemy, as posed at the landing point before the firing tick. */
  enemy: EnemyView;
  /** The puddle that landed on it, as the firing tick left it. */
  puddle: ZoneView;
}

/**
 * Fire Oil Splash at `level` on an isolated night with one enemy of `type`
 * standing exactly where the firing's first puddle is posed to land, and
 * answer the firing, the enemy as posed, and the puddle.
 *
 * The landing point is {@link POSED_OFFSET} from the lamplighter's center,
 * posed through `setNextPuddleOffset` as the file comment explains; the enemy
 * is placed there before the firing tick.
 */
export async function fireOntoEnemy(
  h: Harness,
  type: EnemyId,
  level = 1,
): Promise<Landing> {
  const opened = await isolate(h);
  const landing: XY = {
    x: opened.run.player.x + POSED_OFFSET.x,
    y: opened.run.player.y + POSED_OFFSET.y,
  };
  await h.debug.setNextPuddleOffset(POSED_OFFSET.x, POSED_OFFSET.y);
  const enemy = await placeEnemy(h, type, landing.x, landing.y);
  const firing = await fireOil(h, level);
  const puddle = puddlesOf(firing).find((zone) =>
    samePoint(centerOf(zone), landing),
  );
  if (puddle === undefined) {
    fail(
      `a puddle landing at (${landing.x}, ${landing.y}), the lamplighter's ` +
        "center plus the posed offset (specs/instrumentation.md, " +
        "setNextPuddleOffset)",
      puddlesOf(firing).map(centerOf),
    );
  }
  return { firing, enemy, puddle };
}

/**
 * The `row-N` check: hold Oil Splash at `level` on an isolated night, run the
 * tick it fires on, write the `row` still, and assert what row `level` of
 * `OIL_SPLASH_LEVELS` gives the firing.
 *
 * `specs/weapons.md` ("Oil Splash"): "On firing, `amount` puddles appear",
 * "A puddle is a circle of `radius` that stays where it landed for `duration`
 * seconds", and "each pulse deals `damage`"; ("Derived stats") the radius is
 * the "table value × `areaMul`" and the damage the "table value ×
 * `damageMul`", both `1` with no passive held, the amount the "table value +
 * `amountBonus`", `0` with none held, and the duration the "table value,
 * unchanged"; ("Cooldown timers") "After firing, the timer is set to the
 * weapon's current cooldown", "the table cooldown times `cooldownMul`", so
 * the slot reads the table cooldown on the firing tick. A zone's `ttl` is
 * "its seconds left" (`specs/state.md`), and phase 6 of `specs/world.md`
 * counts down only the shapes "that existed before this tick", so the firing
 * tick's snapshot reads it at `duration` exactly.
 *
 * TOLERANCE. `FLOAT_TOL` on the radius and the damage, each a table figure
 * times `1`; `TIMER_TOL` on the ttl and on the timer the firing set. The
 * puddle count is exact.
 */
export async function checkOilRow(h: Harness, level: number): Promise<void> {
  const row = weaponRow(OIL, level);
  const amount = row.amount ?? 0;
  assertTrue(
    amount > 0,
    `a positive amount in row ${level} of OIL_SPLASH_LEVELS`,
  );

  await isolate(h);
  const firing = await fireOil(h, level);
  await captureStill(h, "row");

  const puddles = puddlesOf(firing);
  assertEqual(
    puddles.length,
    amount,
    `Oil Splash puddle zones the level-${level} firing tick created`,
  );
  for (const puddle of puddles) {
    assertNear(
      puddle.radius,
      row.radius ?? NaN,
      FLOAT_TOL,
      `puddle ${puddle.id}'s radius at level ${level}`,
    );
    assertNear(
      puddle.damage,
      row.damage,
      FLOAT_TOL,
      `puddle ${puddle.id}'s damage at level ${level}`,
    );
    assertNear(
      puddle.ttl ?? NaN,
      row.duration ?? NaN,
      TIMER_TOL,
      `puddle ${puddle.id}'s ttl at level ${level}`,
    );
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, OIL, "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    row.cooldown ?? NaN,
    TIMER_TOL,
    `Oil Splash's timer after the level-${level} firing`,
  );
}
