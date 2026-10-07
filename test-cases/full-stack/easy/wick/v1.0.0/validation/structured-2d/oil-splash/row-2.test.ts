// oil-splash/row-2 — row 2 of `OIL_SPLASH_LEVELS` is in force at level 2.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/weapons.md` ("Oil Splash"), the level table, row 2: damage 4,
//     cooldown 3.0, radius 50, duration 2.5, amount 2. "Every
//     level table has `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level
//     `i + 1`."
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", radius "table value × `areaMul`", cooldown "table value
//     × `cooldownMul`, floored at `MIN_COOLDOWN`", amount "table value +
//     `amountBonus`", and "Speed, Pierce, Duration" are "table value,
//     unchanged"; with no passive held every multiplier is 1 and the bonus 0
//     (`specs/passives.md`), so each figure reads its table value.
//   - `specs/weapons.md` ("Oil Splash"): "On firing, `amount` puddles
//     appear ... A puddle is a circle of `radius` that stays where it landed
//     for `duration` seconds and then vanishes", and "each pulse deals
//     `damage` to every enemy overlapping it".
//   - `specs/state.md` ("ZoneState"): `kind` is "`puddle` for an Oil Splash
//     or Blaze puddle", `ttl` is "the seconds the zone has left", and "a
//     puddle [holds] its `duration`"; `specs/world.md` ("One tick"), phase 6,
//     counts down only the zones "that existed before this tick", so on the
//     firing tick `ttl` reads the duration.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is
//     set to the weapon's current cooldown", so the slot reads 3.0 on the
//     firing tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy (Oil Splash
// "fires whether or not any enemy exists") and no passive, Oil Splash held at
// level 2 with its timer at 0, and `weaponFire` the one switch on. The
// firing tick runs once: 2 zones of kind `puddle` with radius 50,
// damage 4, and ttl 2.5, and the slot's timer reads 3.0. Where the
// puddles landed is the scatter checks' point; the row holds wherever they
// fell.
//
// THE TOLERANCE. `REAL_EPS` on each figure, a table value times a multiplier
// of 1 or copied unchanged; the puddle count and the kind are exact. Where
// two rows differ in a figure they differ by at least 1 of damage, 0.5 of
// cooldown, 5 of radius, 0.5 of duration, or 1 of amount, all far outside
// the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { OIL_SPLASH_LEVELS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireOilSplash } from "./firing";

/** The row under test. */
const LEVEL = 2;
const ROW = OIL_SPLASH_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 2 puddle zones of radius 50, damage 4, and ttl 2.5, and sets the timer to 3.0 at level 2", async () => {
  const firing = await fireOilSplash(h, LEVEL);
  captureStill(h, "row");

  assertEqual(
    firing.puddles.length,
    ROW.amount,
    `the puddles the firing tick created at level ${LEVEL} (specs/weapons.md, Oil Splash)`,
  );
  for (const puddle of firing.puddles) {
    assertEqual(
      puddle.kind,
      "puddle",
      `zone ${puddle.id}'s kind at level ${LEVEL} (specs/state.md, ZoneState)`,
    );
    assertNear(
      puddle.radius,
      ROW.radius,
      REAL_EPS,
      `puddle ${puddle.id}'s radius at level ${LEVEL}`,
    );
    assertNear(
      puddle.damage,
      ROW.damage,
      REAL_EPS,
      `puddle ${puddle.id}'s damage at level ${LEVEL}`,
    );
    assertNear(
      puddle.ttl ?? NaN,
      ROW.duration,
      REAL_EPS,
      `puddle ${puddle.id}'s ttl on the firing tick at level ${LEVEL}`,
    );
  }
  assertNear(
    firing.after.run.weapons[firing.slot]?.cooldown ?? NaN,
    ROW.cooldown,
    REAL_EPS,
    `Oil Splash's timer after the firing at level ${LEVEL}`,
  );
});
