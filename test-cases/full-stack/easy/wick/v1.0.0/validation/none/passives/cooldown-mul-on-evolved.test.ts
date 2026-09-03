// Wick — passives/cooldown-mul-on-evolved: an evolved weapon's fixed cooldown
// passes through `cooldownMul` as a table row does.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`: "The formulas apply to
// every weapon alike, base and evolved. An evolved weapon's single stat row
// passes through damageMul, cooldownMul, areaMul, and amountBonus exactly as a
// base weapon's table row does", over
// "`cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil`" with
// `OIL_COOLDOWN_PER_LEVEL` (`0.08`) and the floor at `MIN_COOLDOWN` (`0.2`).
// `specs/evolutions.md` ("Passives still apply") repeats it: "cooldown is the
// fixed cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)".
// `PYRE_STATS` carries cooldown `1.2`, so with Oil at level 2 the timer a
// firing sets reads `1.2 × 0.84 = 1.008`, clear of the floor.
//
// THE POSE. An isolated night with Oil 2 held through `setPassive` and Pyre
// held at its single level and fired by one tick. Pyre is Taper's slash, which
// needs no target, so no enemy is posed and every other faculty stays held: the
// reading is the timer the firing set.
//
// TOLERANCE. `TIMER_TOL` (`1e-6`) on the timer, the case's allowance for a
// count in seconds. The unscaled `1.2` is nearly two tenths of a second away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { TIMER_TOL, effectiveCooldown, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

/** The Oil level held: `cooldownMul` `0.84`. */
const OIL_LEVEL = 2;

/** `max(0.2, 1.2 × 0.84)`. */
const EXPECTED = effectiveCooldown(weaponRow("pyre").cooldown ?? NaN, {
  oil: OIL_LEVEL,
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets Pyre's timer to 1.008 with Oil 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "oil", OIL_LEVEL);

  const firing = await fireWeapon(h, "pyre");
  await captureStill(h, "evolved");

  assertNear(
    firing.after.run.weapons?.[firing.slot]?.cooldown ?? NaN,
    EXPECTED,
    TIMER_TOL,
    "Pyre's timer after a firing with Oil 2 held",
  );
});
