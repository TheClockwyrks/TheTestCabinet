// evolutions/hail-row — HAIL_STATS is in force.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/evolutions.md` ("Hail"), `HAIL_STATS`: damage 15, cooldown 0.5,
//     speed 700, radius 7, pierce 3, duration 1.5, amount 6.
//   - `specs/evolutions.md` ("Hail"): "Hail is Pin's dart: a circle of
//     `radius` fired horizontally in the facing direction at `speed`, removed
//     after `duration` seconds, with the row's `pierce`, fired whether or not
//     any enemy exists. Amount `n` darts fire on the same tick".
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`", every radius "the fixed length times
//     `areaMul`", amount "the fixed amount plus `amountBonus`", and "Speed,
//     pierce, duration ... are used as written". No passive is held, so every
//     multiplier is 1 and the bonus 0 (`specs/passives.md`).
//   - `specs/world.md` ("One tick"), phase 6: a new projectile hits "at the
//     position it was created at and first moving on the next tick", so on the
//     firing tick each dart still carries the velocity the firing gave it and
//     a `ttl` of its whole `duration`.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", so the slot reads 0.5 on the firing
//     tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy — Hail fires
// "whether or not any enemy exists" — and no passive, Hail armed, and
// `weaponFire` the one switch on. The firing tick runs once and its six darts
// are read where they were created. Where each dart STARTS is `hail-spread`'s
// point; the row holds wherever they were placed.
//
// THE TOLERANCE. `REAL_EPS` on each figure taken straight off the row, and
// `MOTION_EPS` on the speed, the length of a velocity the firing set; the
// count and the pierce are whole numbers read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HAIL_STATS, MOTION_EPS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireEvolved } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates six darts of radius 7, damage 15, pierce 3 and ttl 1.5 at speed 700, and sets the timer to 0.5", async () => {
  const firing = await fireEvolved(h, "hail");
  captureStill(h, "row");

  assertEqual(
    firing.projectiles.length,
    HAIL_STATS.amount,
    "the darts the firing tick created (specs/evolutions.md, Hail)",
  );
  for (const dart of firing.projectiles) {
    assertNear(
      dart.radius,
      HAIL_STATS.radius,
      REAL_EPS,
      `dart ${dart.id}'s radius (specs/evolutions.md, HAIL_STATS)`,
    );
    assertNear(
      dart.damage,
      HAIL_STATS.damage,
      REAL_EPS,
      `dart ${dart.id}'s damage (specs/evolutions.md, HAIL_STATS)`,
    );
    assertNear(
      dart.ttl,
      HAIL_STATS.duration,
      REAL_EPS,
      `dart ${dart.id}'s ttl on the firing tick (specs/evolutions.md, HAIL_STATS)`,
    );
    assertEqual(
      dart.pierce,
      HAIL_STATS.pierce,
      `dart ${dart.id}'s pierce (specs/evolutions.md, HAIL_STATS)`,
    );
    assertNear(
      Math.hypot(dart.vx, dart.vy),
      HAIL_STATS.speed,
      MOTION_EPS,
      `dart ${dart.id}'s speed, the length of its velocity (specs/evolutions.md, HAIL_STATS)`,
    );
  }
  assertNear(
    firing.after.run.weapons[firing.slot]?.cooldown ?? Number.NaN,
    HAIL_STATS.cooldown,
    REAL_EPS,
    "Hail's timer after the firing (specs/weapons.md, Cooldown timers)",
  );
});
