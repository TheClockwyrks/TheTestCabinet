// Wick — passives/cooldown-mul-read-when-set: a timer already counting keeps
// the value it was set with, and the next firing reads the Oil level gained
// since.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "A weapon's
// timer is set from this value each time the weapon fires, and a timer already
// counting keeps the value it was set with", over "A derived stat is computed
// from the levels held at the moment it is read, so a passive gained mid-run
// takes effect on the next read: ... the next time a weapon sets its cooldown
// timer". `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on". So a Taper timer
// posed at `1.0` is due `60` ticks later whatever Oil is gained in the
// meantime, and the firing on that tick sets the timer to
// `1.35 × 0.6 = 0.81`, row 1 of `TAPER_LEVELS` times `cooldownMul` at Oil 5.
//
// THE POSE. An isolated night with Taper held at level 1, its timer posed to
// `1.0` through `setWeaponCooldown`, and Oil 5 placed through `setPassive`
// afterwards, so the level is gained while the timer counts. `weaponFire` is
// then turned on and `HOLD` (`60`) ticks are driven: Taper "needs no target",
// so no enemy is posed, and every other faculty stays held. The reading is the
// tick the slash appeared on and the timer that firing set.
//
// TOLERANCE. `TIMER_TOL` (`1e-6`) on the timer the firing set; the tick it
// fired on is exact. A build that recomputed the running timer from the new
// Oil level would fire on tick `36` (`round(1.0 × 0.6 × 60)`), and one that
// ignored Oil at the firing would set `1.35`.

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
  enable,
  holdPassive,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";
import { firedOn } from "./stage";

/** The Oil level gained while the timer counts: `cooldownMul` `0.6`. */
const OIL_LEVEL = 5;

/** The Taper level held: table cooldown `1.35`. */
const LEVEL = 1;

/** The seconds the running timer is posed at, before Oil is gained. */
const RUNNING = 1.0;

/** `round(1.0 × 60)`: the tick the running timer is due on. */
const HOLD = dueTicks(RUNNING);

/** `max(0.2, 1.35 × 0.6)`: what the firing on that tick sets. */
const EXPECTED_COOLDOWN = effectiveCooldown(
  weaponRow("taper", LEVEL).cooldown ?? NaN,
  { oil: OIL_LEVEL },
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a Taper timer counting from 1.0 when Oil 5 is gained, and sets 0.81 on the firing", async () => {
  const opened = await isolate(h);
  const slot = await holdWeapon(h, "taper", LEVEL);
  await h.debug.setWeaponCooldown(slot, RUNNING);
  await holdPassive(h, "oil", OIL_LEVEL);
  await enable(h, "weaponFire");

  const ticks = await captureReplay(h, "kept", () => h.stepWatching(HOLD));

  assertDeepEqual(
    firedOn(opened, ticks, "taper"),
    [HOLD],
    "the ticks on which Taper fired while the posed timer counted",
  );
  assertNear(
    ticks[HOLD - 1]?.run.weapons?.[slot]?.cooldown ?? NaN,
    EXPECTED_COOLDOWN,
    TIMER_TOL,
    "Taper's timer after the firing that read Oil 5",
  );
});
