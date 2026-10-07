// instrumentation/set-weapon-timer-kept-on-level — with Taper's cooldown
// counting at 1.0, `setWeapon(0, 'taper', 5)` reads back cooldown 1.0 and the
// timer keeps counting from there.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setWeapon`: "when
// only the level changes the timer keeps counting". specs/world.md, "Timers":
// "On every tick a timer counts down by `TICK_DT`".
//
// THE POSE. An isolated run keeping its Taper with its timer posed to 1.0,
// the level pose, the read-back, `weaponFire` on, and one tick: the timer
// reads 1.0 − TICK_DT.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const COUNTING = 1.0;
const LEVEL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the timer when only the level changes", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setWeaponCooldown(0, COUNTING);

  h.debug.setWeapon(0, "taper", LEVEL);
  const s = h.snapshot();
  assertEqual(s.run.weapons[0].id, "taper", "the slot's id after the pose");
  assertEqual(s.run.weapons[0].level, LEVEL, "the slot's level after the pose");
  assertEqual(s.run.weapons[0].cooldown, COUNTING, "the slot's timer, kept");

  enable(h, "weaponFire");
  const counting = await h.tick(1);
  captureStill(h, "kept");
  assertWithin(
    counting.run.weapons[0].cooldown,
    COUNTING - TICK_DT,
    FIGURE_TOLERANCE,
    "the timer one tick on, counting from where it stood",
  );
});
