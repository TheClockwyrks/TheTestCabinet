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
// THE POSE. An isolated night with Oil 5 held, and the weapon held at level 1
// and fired by one tick. It needs no target, so no enemy is posed.
//
// TOLERANCE. `TIMER_TOL` (`1e-6`) on the timer, the case's allowance for a
// count in seconds. The nearest wrong answer, the unscaled figure, is far
// outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { HALO_LEVELS, REAL_EPS, cooldownOf } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder, timerOf } from "./firing";

/** The Oil level held: `cooldownMul` `0.6`. */
const OIL = 5;

/** The table figure times `cooldownMul`, floored at `MIN_COOLDOWN`. */
const EXPECTED = cooldownOf(HALO_LEVELS[0].cooldown, OIL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads 0.6 under Oil 5", async () => {
  const firing = await fireUnder(h, {
    passives: [["oil", OIL]],
    weapons: [["halo", 1]],
  });
  captureStill(h, "interval");

  assertNear(
    timerOf(firing, "halo"),
    EXPECTED,
    REAL_EPS,
    "the timer after the first firing under Oil 5 (specs/passives.md, Cooldown)",
  );
});
