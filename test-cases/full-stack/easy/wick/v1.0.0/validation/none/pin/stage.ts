// pin/stage — what the Pin checks share: the one firing every check poses, and
// the figures each row of `PIN_LEVELS` fixes for it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Pin"): "A dart is a
// circle of `radius`, fired horizontally in the facing direction at `speed`,
// and removed after `duration` seconds. Its pierce is the table `pierce`. Pin
// fires whether or not any enemy exists." and "Amount `n` darts fire on the
// same tick". The row's columns pass through the derived stats of
// `specs/passives.md` as "Derived stats" states: damage is "table value ×
// `damageMul`", radius "table value × `areaMul`", amount "table value +
// `amountBonus`", and speed, pierce, and duration are "table value,
// unchanged"; with no passive held every multiplier is `1` and the bonus is
// `0` (`specs/passives.md`), so each figure is the row's own. The timer:
// "After firing, the timer is set to the weapon's current cooldown", which is
// "the table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)"
// ("Cooldown timers"), and every Pin cooldown is above that floor. The ttl: "A
// projectile's `ttl` is set to its `duration` when it is fired" ("Projectiles
// and pierce"), and phase 6 of `specs/world.md` counts down only the shapes
// "that existed before this tick", so the firing tick's snapshot reads it at
// `duration` exactly.
//
// WHAT IS READ. The projectiles the firing tick created — the entries whose id
// is at least the `nextId` the run held before the tick — and the timer of
// the slot Pin fired from, both off the firing tick's snapshot. A dart's speed
// is the length of its velocity, since which way it flies is `fires-facing-*`'s
// point and its vertical placement is `spread`'s.
//
// THE POSE. An isolated night with Pin alone, held at the row's level, due at
// once, fired through the shared `fireWeapon` (`weaponFire` on, one tick).
// Nothing else runs — no spawns, no motion, no contact, no effect motion — so
// the only ids the tick hands out are the darts', and Pin needs no target, so
// no enemy is posed and the darts hit nothing.
//
// TOLERANCE. `FLOAT_TOL` on radius, damage, and speed, each a table figure
// times a multiplier of `1` or the length of a velocity a build composed from
// the figure; `TIMER_TOL` on the timer and the ttl, each set from a table
// figure; none on the count and the pierce, which are whole numbers.

import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { FLOAT_TOL, TIMER_TOL, weaponRow } from "../constants";
import { fireWeapon, weaponIn, type Firing, type Harness } from "../harness";

/** One row of `PIN_LEVELS`, with every column a Pin row carries. */
export interface PinRow {
  damage: number;
  cooldown: number;
  speed: number;
  radius: number;
  pierce: number;
  duration: number;
  amount: number;
}

/** The row `level` reads. */
export function pinRow(level: number): PinRow {
  const row = weaponRow("pin", level);
  return {
    damage: row.damage,
    cooldown: row.cooldown!,
    speed: row.speed!,
    radius: row.radius!,
    pierce: row.pierce!,
    duration: row.duration!,
    amount: row.amount!,
  };
}

/** Hold Pin at `level` on an isolated night already posed, and run the tick it fires on. */
export function firePin(h: Harness, level: number): Promise<Firing> {
  return fireWeapon(h, "pin", level);
}

/**
 * Every dart the firing created carries row `level`'s figures, there are
 * `amount` of them, and Pin's timer reads the row's cooldown.
 */
export function assertRowFiring(fired: Firing, level: number): void {
  const row = pinRow(level);
  const darts = fired.projectiles;
  assertGreaterThan(darts.length, 0, "projectiles the firing tick created");
  for (const dart of darts) {
    assertEqual(dart.weapon, "pin", `the weapon of projectile ${dart.id}`);
  }
  assertEqual(
    darts.length,
    row.amount,
    `Pin darts the firing tick created at level ${level}`,
  );
  for (const [index, dart] of darts.entries()) {
    const what = `dart ${index} of the level-${level} firing`;
    assertNear(dart.radius, row.radius, FLOAT_TOL, `${what}: radius`);
    assertNear(dart.damage, row.damage, FLOAT_TOL, `${what}: damage`);
    assertNear(
      Math.hypot(dart.vx, dart.vy),
      row.speed,
      FLOAT_TOL,
      `${what}: speed`,
    );
    assertEqual(dart.pierce, row.pierce, `${what}: pierce`);
    assertNear(dart.ttl, row.duration, TIMER_TOL, `${what}: ttl`);
  }
  assertNear(
    weaponIn(fired.after, "pin")?.cooldown ?? NaN,
    row.cooldown,
    TIMER_TOL,
    `Pin's timer on the tick it fired at level ${level}`,
  );
}
