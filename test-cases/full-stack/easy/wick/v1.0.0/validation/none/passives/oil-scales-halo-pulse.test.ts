// Wick — passives/oil-scales-halo-pulse: `cooldownMul` scales the aura's pulse
// interval like any other cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "For Halo
// and Corona the table `cooldown` is the pulse interval of the aura", over
// "`cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil`" with
// `OIL_COOLDOWN_PER_LEVEL` (`0.08`). At Oil level 5, `cooldownMul` is `0.6`.
// Row 1 of `HALO_LEVELS` (`specs/weapons.md`) carries cooldown `1.00`, so the
// timer a pulse sets reads `0.6`, clear of `MIN_COOLDOWN` (`0.2`). The other
// interval Oil scales is `passives/oil-scales-flare-burst`.
//
// THE POSE. An isolated night with Oil 5 held through `setPassive`, and Halo
// held at level 1 and fired by one tick. It needs no target, so no enemy is
// posed; the reading is the timer the tick left. Every other faculty stays
// held, so nothing else fires and nothing moves.
//
// TOLERANCE. `TIMER_TOL` (`1e-6`) on the timer, the case's allowance for a
// count in seconds. The nearest wrong answer, the unscaled figure, is far
// outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { TIMER_TOL, effectiveCooldown, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { fireVolley, timerOf } from "./stage";

/** The Oil level held: `cooldownMul` `0.6`. */
const OIL_LEVEL = 5;

/** The level the weapon is held at. */
const LEVEL = 1;

/** The table figure times `cooldownMul`, floored at `MIN_COOLDOWN`. */
const EXPECTED = effectiveCooldown(weaponRow("halo", LEVEL).cooldown ?? NaN, {
  oil: OIL_LEVEL,
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads 0.6 with Oil 5 held", async () => {
  await isolate(h);
  await holdPassive(h, "oil", OIL_LEVEL);

  const volley = await fireVolley(h, [{ id: "halo", level: LEVEL }]);
  await captureStill(h, "interval");

  assertNear(
    timerOf(volley, "halo"),
    EXPECTED,
    TIMER_TOL,
    "the timer after the level-1 firing with Oil 5 held",
  );
});
