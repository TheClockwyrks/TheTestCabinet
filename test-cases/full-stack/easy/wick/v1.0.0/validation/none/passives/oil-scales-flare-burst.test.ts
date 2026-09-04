// Wick — passives/oil-scales-flare-burst: `cooldownMul` scales the interval
// between bursts like any other cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "for Flare
// it is the interval between bursts; both scale the same way", over
// "`cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil`" with
// `OIL_COOLDOWN_PER_LEVEL` (`0.08`). At Oil level 5, `cooldownMul` is `0.6`.
// Row 1 of `FLARE_LEVELS` carries `60`, so the timer a burst sets reads `36`,
// clear of `MIN_COOLDOWN` (`0.2`). The other interval Oil scales is
// `passives/oil-scales-halo-pulse`.
//
// THE POSE. An isolated night with Oil 5 held through `setPassive`, and Flare
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
const EXPECTED = effectiveCooldown(weaponRow("flare", LEVEL).cooldown ?? NaN, {
  oil: OIL_LEVEL,
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads 36 with Oil 5 held", async () => {
  await isolate(h);
  await holdPassive(h, "oil", OIL_LEVEL);

  const volley = await fireVolley(h, [{ id: "flare", level: LEVEL }]);
  await captureStill(h, "interval");

  assertNear(
    timerOf(volley, "flare"),
    EXPECTED,
    TIMER_TOL,
    "the timer after the level-1 firing with Oil 5 held",
  );
});
