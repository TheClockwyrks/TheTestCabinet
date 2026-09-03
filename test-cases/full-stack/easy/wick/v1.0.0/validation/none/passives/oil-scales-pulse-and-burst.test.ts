// Wick — passives/oil-scales-pulse-and-burst: `cooldownMul` scales the aura's
// pulse interval and Flare's burst interval like any other cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "For Halo
// and Corona the table `cooldown` is the pulse interval of the aura, and for
// Flare it is the interval between bursts; both scale the same way", over
// "`cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil`" with
// `OIL_COOLDOWN_PER_LEVEL` (`0.08`). At Oil level 5, `cooldownMul` is `0.6`.
// Row 1 of `HALO_LEVELS` (`specs/weapons.md`) carries cooldown `1.00`, so the
// timer a pulse sets reads `0.6`; row 1 of `FLARE_LEVELS` carries `60`, so the
// timer a burst sets reads `36`. Both are clear of `MIN_COOLDOWN` (`0.2`).
//
// THE POSE. An isolated night with Oil 5 held through `setPassive`, and Halo
// and Flare held at level 1 and fired by one tick together. Neither needs a
// target, so no enemy is posed; the reading is the two timers the tick left.
// Every other faculty stays held, so nothing else fires and nothing moves.
//
// TOLERANCE. `TIMER_TOL` (`1e-6`) on each timer, the case's allowance for a
// count in seconds. The nearest wrong answers, the unscaled `1.0` and `60`, are
// tenths and tens of seconds away.

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

/** The level both weapons are held at. */
const LEVEL = 1;

/** `max(0.2, 1.00 × 0.6)`. */
const EXPECTED_PULSE = effectiveCooldown(
  weaponRow("halo", LEVEL).cooldown ?? NaN,
  { oil: OIL_LEVEL },
);

/** `max(0.2, 60 × 0.6)`. */
const EXPECTED_BURST = effectiveCooldown(
  weaponRow("flare", LEVEL).cooldown ?? NaN,
  { oil: OIL_LEVEL },
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets Halo's timer to 0.6 and Flare's to 36 with Oil 5 held", async () => {
  await isolate(h);
  await holdPassive(h, "oil", OIL_LEVEL);

  const volley = await fireVolley(h, [
    { id: "halo", level: LEVEL },
    { id: "flare", level: LEVEL },
  ]);
  await captureStill(h, "intervals");

  assertNear(
    timerOf(volley, "halo"),
    EXPECTED_PULSE,
    TIMER_TOL,
    "Halo's timer after the level-1 pulse with Oil 5 held",
  );
  assertNear(
    timerOf(volley, "flare"),
    EXPECTED_BURST,
    TIMER_TOL,
    "Flare's timer after the level-1 burst with Oil 5 held",
  );
});
