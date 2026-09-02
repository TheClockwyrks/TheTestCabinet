// Wick — evolutions/blaze-row: `BLAZE_STATS` is in force.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Blaze"): "on each
// firing, `amount` puddles appear ... each a circle of `radius` that stays where
// it landed for `duration` seconds", and "The fixed row is `BLAZE_STATS`":
// damage `8`, cooldown `2.0`, radius `70`, duration `4.0`, amount `5`.
// ("Passives still apply"): damage times `damageMul`, cooldown times
// `cooldownMul` floored at `MIN_COOLDOWN` (`0.2`), radius times `areaMul`, and
// amount plus `amountBonus`; every multiplier is `1` and the bonus `0` with no
// passive held (`specs/passives.md`). `specs/weapons.md` ("Cooldown timers"):
// "After firing, the timer is set to the weapon's current cooldown".
// `specs/state.md` makes a zone's seconds left its `ttl`, and `specs/world.md`
// (phase 6) counts down only the shapes "that existed before this tick", so the
// firing tick's snapshot reads it at `duration` exactly. So the firing tick
// creates five zones of kind `puddle` and weapon `blaze`, each reading radius
// `70`, damage `8`, and ttl `4.0`, and the slot reads `2.0` after it.
//
// THE POSE. An isolated night with Blaze held at level 1 fired through the
// shared `fireWeapon`. No enemy is posed: Blaze needs no target, and the reading
// is the zones the tick created, told by id from the `nextId` the run held
// before it.
//
// TOLERANCE. `FLOAT_TOL` on the radius and the damage, each a fixed figure
// times `1`; `TIMER_TOL` on the ttl and on the timer the firing set. The puddle
// count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, TIMER_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { zonesFired } from "./stage";

/** Blaze's fixed row, `BLAZE_STATS`. */
const ROW = weaponRow("blaze");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates five puddle zones of radius 70 with damage 8 and ttl 4.0 and sets the timer to 2.0", async () => {
  await isolate(h);

  const firing = await fireWeapon(h, "blaze", 1);
  await captureStill(h, "row");

  const puddles = zonesFired(firing, "blaze", "puddle");
  assertEqual(
    puddles.length,
    ROW.amount,
    "Blaze puddle zones the firing tick created",
  );
  for (const puddle of puddles) {
    assertNear(
      puddle.radius,
      ROW.radius ?? NaN,
      FLOAT_TOL,
      `puddle ${puddle.id}'s radius`,
    );
    assertNear(
      puddle.damage,
      ROW.damage,
      FLOAT_TOL,
      `puddle ${puddle.id}'s damage`,
    );
    assertNear(
      puddle.ttl ?? NaN,
      ROW.duration ?? NaN,
      TIMER_TOL,
      `puddle ${puddle.id}'s ttl`,
    );
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, "blaze", "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    ROW.cooldown ?? NaN,
    TIMER_TOL,
    "Blaze's timer after the firing",
  );
});
