// shard/row-5 — row 5 of `SHARD_LEVELS` is in force at level 5.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/weapons.md` ("Shard"), the level table, row 5: damage
//     12, cooldown 2.2, speed 500, radius 8, duration 4.0,
//     amount 2. "Every level table has `MAX_WEAPON_LEVEL` (`8`) rows; row
//     `i` is level `i + 1`."
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", radius "table value × `areaMul`", cooldown "table value ×
//     `cooldownMul`, floored at `MIN_COOLDOWN`", amount "table value +
//     `amountBonus`", and "Speed, Pierce, Duration" are "table value,
//     unchanged"; with no passive held every multiplier is 1 and the bonus 0
//     (`specs/passives.md`), so each figure reads its table value.
//   - `specs/weapons.md` ("Shard"): "A shard is a circle of `radius`, fired
//     from the player's center at `speed` toward the nearest enemy ... Its
//     pierce is `INFINITE_PIERCE`, its re-hit interval is `SHARD_REHIT`
//     (`0.5`) per shard per enemy, and it is removed after `duration`
//     seconds", and "Amount `n` fires `n` shards on the same tick".
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl` is
//     set to its `duration` when it is fired", and `specs/world.md` ("One
//     tick"), phase 6, counts down only the projectiles "that existed before
//     this tick", so on the firing tick `ttl` reads the duration.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", so the slot reads 2.2 on the firing
//     tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth at
// `TARGET_POST` and no passive, Shard held at level 5 with its timer at 0,
// and `weaponFire` the one switch on. Shard "fires whether or not any enemy
// exists", so the moth is not what makes the firing happen; it stands 500
// units out so the firing is the ordinary aimed one and no shard created at
// the player's center overlaps it on that tick. The firing tick runs once:
// 2 shards of radius 8 with damage 12, speed 500, pierce -1, and
// ttl 4.0, and the slot's timer reads 2.2. Speed is read as the length of
// the velocity, so the row holds whichever way the shards were aimed; the
// direction is the aiming checks' point.
//
// THE TOLERANCE. `REAL_EPS` on each figure, a table value times a multiplier
// of 1 or copied unchanged, and on the velocity's length, which is the stated
// speed along a unit vector; the shard count and the pierce are exact. The
// nearest rows differ by at least 2 of damage, 0.2 of cooldown, 50 of speed, 1
// of radius, 0.5 of duration, or 1 of amount, all far outside the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { INFINITE_PIERCE, REAL_EPS, SHARD_LEVELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireShard, TARGET_POST } from "./firing";

/** The row under test. */
const LEVEL = 5;
const ROW = SHARD_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 2 shards of radius 8, damage 12, speed 500, pierce -1, and ttl 4.0, and sets the timer to 2.2 at level 5", async () => {
  const firing = await fireShard(h, LEVEL, [TARGET_POST]);
  captureStill(h, "row");

  assertEqual(
    firing.shards.length,
    ROW.amount,
    `the shards the firing tick created at level ${LEVEL} (specs/weapons.md, Shard)`,
  );
  for (const shard of firing.shards) {
    assertNear(
      shard.radius,
      ROW.radius,
      REAL_EPS,
      `shard ${shard.id}'s radius at level ${LEVEL}`,
    );
    assertNear(
      shard.damage,
      ROW.damage,
      REAL_EPS,
      `shard ${shard.id}'s damage at level ${LEVEL}`,
    );
    assertNear(
      Math.hypot(shard.vx, shard.vy),
      ROW.speed,
      REAL_EPS,
      `shard ${shard.id}'s speed, the length of its velocity, at level ${LEVEL}`,
    );
    assertEqual(
      shard.pierce,
      INFINITE_PIERCE,
      `shard ${shard.id}'s pierce at level ${LEVEL}`,
    );
    assertNear(
      shard.ttl,
      ROW.duration,
      REAL_EPS,
      `shard ${shard.id}'s ttl on the firing tick at level ${LEVEL}`,
    );
  }
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    ROW.cooldown,
    REAL_EPS,
    `Shard's timer after the firing at level ${LEVEL}`,
  );
});
