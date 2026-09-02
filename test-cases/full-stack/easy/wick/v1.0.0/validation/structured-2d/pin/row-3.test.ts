// pin/row-3 — row 3 of `PIN_LEVELS` is in force at level 3.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/weapons.md` ("Pin"), the level table, row 3: damage 8,
//     cooldown 0.5, speed 600, radius 6, pierce 1, duration 1.5,
//     amount 2. "Every level table has `MAX_WEAPON_LEVEL` (`8`) rows; row
//     `i` is level `i + 1`."
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", radius "table value × `areaMul`", cooldown "table value
//     × `cooldownMul`, floored at `MIN_COOLDOWN`", amount "table value +
//     `amountBonus`", and "Speed, Pierce, Duration" are "table value,
//     unchanged"; with no passive held every multiplier is 1 and the bonus 0
//     (`specs/passives.md`), so each figure reads its table value.
//   - `specs/weapons.md` ("Pin"): "A dart is a circle of `radius`, fired
//     horizontally in the facing direction at `speed` ... Its pierce is the
//     table `pierce`", and "Amount `n` darts fire on the same tick".
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl`
//     is set to its `duration` when it is fired", and `specs/world.md`
//     ("One tick"), phase 6, counts down only the projectiles "that existed
//     before this tick", so on the firing tick `ttl` reads the duration.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is
//     set to the weapon's current cooldown", so the slot reads 0.5 on the
//     firing tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy (Pin "fires
// whether or not any enemy exists") and no passive, Pin held at level 3
// with its timer at 0, and `weaponFire` the one switch on. The firing tick
// runs once: 2 projectiles of radius 6 with damage 8, speed 600,
// pierce 1, and ttl 1.5, and the slot's timer reads 0.5. Speed is
// read as the length of the velocity, so the row holds whichever way the
// lamplighter faces; the direction is the facing checks' point.
//
// THE TOLERANCE. `REAL_EPS` on each figure, a table value times a
// multiplier of 1 or copied unchanged, and on the velocity's length, which is
// the stated speed along one axis; the dart count is exact. The nearest rows
// differ by at least 2 damage, 0.05 of cooldown, 100 of speed, 1 of radius, 1
// of pierce, or 1 of amount, all far outside the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { PIN_LEVELS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { firePin } from "./firing";

/** The row under test. */
const LEVEL = 3;
const ROW = PIN_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 2 darts of radius 6, damage 8, speed 600, pierce 1, and ttl 1.5, and sets the timer to 0.5 at level 3", async () => {
  const firing = await firePin(h, LEVEL);
  captureStill(h, "row");

  assertEqual(
    firing.darts.length,
    ROW.amount,
    `the darts the firing tick created at level ${LEVEL} (specs/weapons.md, Pin)`,
  );
  for (const dart of firing.darts) {
    assertNear(
      dart.radius,
      ROW.radius,
      REAL_EPS,
      `dart ${dart.id}'s radius at level ${LEVEL}`,
    );
    assertNear(
      dart.damage,
      ROW.damage,
      REAL_EPS,
      `dart ${dart.id}'s damage at level ${LEVEL}`,
    );
    assertNear(
      Math.hypot(dart.vx, dart.vy),
      ROW.speed,
      REAL_EPS,
      `dart ${dart.id}'s speed, the length of its velocity, at level ${LEVEL}`,
    );
    assertEqual(
      dart.pierce,
      ROW.pierce,
      `dart ${dart.id}'s pierce at level ${LEVEL}`,
    );
    assertNear(
      dart.ttl,
      ROW.duration,
      REAL_EPS,
      `dart ${dart.id}'s ttl on the firing tick at level ${LEVEL}`,
    );
  }
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    ROW.cooldown,
    REAL_EPS,
    `Pin's timer after the firing at level ${LEVEL}`,
  );
});
