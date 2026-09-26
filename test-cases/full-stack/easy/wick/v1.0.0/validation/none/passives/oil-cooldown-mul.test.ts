// Wick — passives/oil-cooldown-mul: Oil multiplies a weapon's cooldown by
// `1 − 0.08` per level, and the weapon fires again after the scaled interval.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil`" with
// `OIL_COOLDOWN_PER_LEVEL` (`0.08`), and ("Cooldown") "A weapon's cooldown is
// its table `cooldown` times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)
// seconds". Row 1 of `TAPER_LEVELS` (`specs/weapons.md`) carries cooldown
// `1.35`, so with Oil at level 2 the timer a firing sets reads
// `1.35 × 0.84 = 1.134`, well clear of the floor. `specs/world.md` ("Timers"):
// "a timer set to `s` seconds is due `round(s × TICK_HZ)` ticks after the tick
// it was set on", so the next firing lands `round(1.134 × 60) = 68` ticks after
// the first.
//
// THE POSE. An isolated night with Oil 2 held through `setPassive` and Taper
// held at level 1 and fired by one tick. Taper "needs no target", so no enemy
// is posed and the reading is the timer the firing set and the tick the next
// slash appears on. `weaponFire` stays on after the firing, so the timer counts
// exactly as it does in play, and every other faculty stays held: nothing else
// fires, nothing moves, and no slash but Taper's own is created.
//
// TOLERANCE. `TIMER_TOL` (`1e-6`) on the timer, the case's allowance for a
// count in seconds; the tick the second firing landed on is exact. The nearest
// wrong answers, an unscaled `1.35` (`81` ticks) and a subtracted `1.27`, are
// tens of ticks away.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNear } from "../assert";
import {
  TIMER_TOL,
  dueTicks,
  effectiveCooldown,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { firedOn } from "./stage";

/** The Oil level held: `cooldownMul` `0.84`. */
const OIL_LEVEL = 2;

/** The Taper level fired: table cooldown `1.35`. */
const LEVEL = 1;

/** `max(0.2, 1.35 × 0.84)`. */
const EXPECTED_COOLDOWN = effectiveCooldown(
  weaponRow("taper", LEVEL).cooldown ?? NaN,
  { oil: OIL_LEVEL },
);

/** `round(1.134 × 60)`. */
const EXPECTED_TICKS = dueTicks(EXPECTED_COOLDOWN);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets Taper's timer to 1.134 with Oil 2 held and fires again 68 ticks later", async () => {
  await isolate(h);
  await holdPassive(h, "oil", OIL_LEVEL);

  const firing = await fireWeapon(h, "taper", LEVEL);
  assertNear(
    firing.after.run.weapons?.[firing.slot]?.cooldown ?? NaN,
    EXPECTED_COOLDOWN,
    TIMER_TOL,
    "Taper's timer after the level-1 firing with Oil 2 held",
  );

  const ticks = await captureReplay(h, "cooldown", () =>
    h.stepWatching(EXPECTED_TICKS),
  );

  assertDeepEqual(
    firedOn(firing.after, ticks, "taper"),
    [EXPECTED_TICKS],
    "the ticks after the first firing on which Taper fired again",
  );
});
