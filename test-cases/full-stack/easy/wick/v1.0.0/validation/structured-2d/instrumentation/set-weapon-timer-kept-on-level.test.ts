// Wick — instrumentation/set-weapon-timer-kept-on-level: with Taper's
// cooldown at 1.0, `setWeapon(0, 'taper', 5)` reads back cooldown 1.0 and the
// timer keeps counting from there.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setWeapon(slot, id, level)`: "when only the level changes the timer keeps
// counting." `specs/world.md`, "Timers": a timer counts down by `TICK_DT` a
// tick while `weaponFire` is on.
//
// THE DRIVE. An isolated run with Taper kept and its timer posed to 1.0, the
// call read at the call, then `weaponFire` on and one tick: `1.0 − TICK_DT`
// (`MOTION_EPS`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const COUNTING = 1.0;
const NEW_LEVEL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the timer across a level-only pose and counts on from it", async () => {
  isolate(h, { taper: true });
  h.debug.setWeaponCooldown(0, COUNTING);

  h.debug.setWeapon(0, "taper", NEW_LEVEL);
  const changed = h.snapshot();
  assertEqual(
    changed.run.weapons[0]?.level,
    NEW_LEVEL,
    "Taper's level after the pose",
  );
  assertEqual(
    changed.run.weapons[0]?.cooldown,
    COUNTING,
    "Taper's timer after a level-only pose",
  );

  enable(h, "weaponFire");
  const counted = await advanceTicks(h, 1);
  captureStill(h, "kept");
  assertNear(
    counted.run.weapons[0]?.cooldown ?? Number.NaN,
    COUNTING - TICK_DT,
    MOTION_EPS,
    "Taper's timer one tick on",
  );
});
