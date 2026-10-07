// evolutions/blaze-row — BLAZE_STATS is in force.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/evolutions.md` ("Blaze"), `BLAZE_STATS`: damage 8, cooldown 2.0,
//     radius 70, duration 4.0, amount 5.
//   - `specs/evolutions.md` ("Blaze"): "on each firing, `amount` puddles
//     appear, each centered at an independent uniformly random point of the
//     disk of radius `OIL_SCATTER` (`400`) about the player's center, each a
//     circle of `radius` that stays where it landed for `duration` seconds."
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`", every radius "the fixed length times
//     `areaMul`", cooldown "the fixed cooldown times `cooldownMul`", and
//     amount "the fixed amount plus `amountBonus`". No passive is held, so
//     every multiplier is 1 and the bonus 0 (`specs/passives.md`).
//   - `specs/state.md` (`ZoneState`): `kind` is "`puddle` for an Oil Splash or
//     Blaze puddle", and `ttl` "the seconds the zone has left", "a puddle
//     [holding] its `duration`"; phase 6 of `specs/world.md` ("One tick")
//     counts down only what "existed before this tick", so on the firing tick
//     `ttl` reads the whole duration.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", so the slot reads 2.0 on the firing
//     tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy — Blaze
// "fires whether or not any enemy exists" — and no passive, Blaze armed, and
// `weaponFire` the one switch on. The firing tick runs once and its five
// puddles are read wherever they fell; WHERE they land is `blaze-scatter`'s
// point.
//
// THE TOLERANCE. `REAL_EPS` on each figure, a row value times a multiplier of
// 1; the puddle count and the kind are exact. Oil Splash's own table tops out
// at radius 70 with damage 8 and duration 4.0 at level 8 but amount 4 and
// cooldown 2.0, so a build that left the base weapon's row in force fails on
// the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BLAZE_STATS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireEvolved } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates five puddle zones of radius 70, damage 8 and ttl 4.0, and sets the timer to 2.0", async () => {
  const firing = await fireEvolved(h, "blaze");
  captureStill(h, "row");

  assertEqual(
    firing.zones.length,
    BLAZE_STATS.amount,
    "the puddles the firing tick created (specs/evolutions.md, Blaze)",
  );
  for (const puddle of firing.zones) {
    assertEqual(
      puddle.kind,
      "puddle",
      `zone ${puddle.id}'s kind (specs/state.md, ZoneState)`,
    );
    assertNear(
      puddle.radius,
      BLAZE_STATS.radius,
      REAL_EPS,
      `puddle ${puddle.id}'s radius (specs/evolutions.md, BLAZE_STATS)`,
    );
    assertNear(
      puddle.damage,
      BLAZE_STATS.damage,
      REAL_EPS,
      `puddle ${puddle.id}'s damage (specs/evolutions.md, BLAZE_STATS)`,
    );
    assertNear(
      puddle.ttl ?? Number.NaN,
      BLAZE_STATS.duration,
      REAL_EPS,
      `puddle ${puddle.id}'s ttl on the firing tick (specs/evolutions.md, BLAZE_STATS)`,
    );
  }
  assertNear(
    firing.after.run.weapons[firing.slot]?.cooldown ?? Number.NaN,
    BLAZE_STATS.cooldown,
    REAL_EPS,
    "Blaze's timer after the firing (specs/weapons.md, Cooldown timers)",
  );
});
