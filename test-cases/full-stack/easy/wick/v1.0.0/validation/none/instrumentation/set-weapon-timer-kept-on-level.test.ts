// Wick — instrumentation/set-weapon-timer-kept-on-level: with Taper's cooldown
// counting at 1.0, `setWeapon(0, "taper", 5)` reads back cooldown 1.0 and the
// timer keeps counting from there.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setWeapon(slot, id, level)`): "when only the level changes the timer keeps
// counting." specs/world.md — "Timers": "On every tick a timer counts down by
// `TICK_DT`", so 30 ticks with `weaponFire` on take 1.0 to 0.5, read to
// `TIMER_TOL`; the kept timer at the pose is read exactly.
//
// WHY THE WORLD IS POSED AS IT IS. Taper's timer is posed to a full second
// first, so a build that zeroed it on any pose reads 0 and fires at once; the
// count afterwards is over 30 ticks, half the timer, so a timer that restarted
// from the table's 1.35 s is told from one that kept counting.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { TICK_DT, TIMER_TOL } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const TAPER_TIMER = 1.0;
const COUNTED_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the timer when only the level changes, and it counts on from there", async () => {
  await isolate(h, { taper: true });
  await h.debug.setWeaponCooldown(0, TAPER_TIMER);

  await h.debug.setWeapon(0, "taper", 5);
  const leveled = await h.snapshot();
  await captureStill(h, "kept");
  assertEqual(
    leveled.run.weapons[0]?.id,
    "taper",
    "the weapon in slot 0 after the level pose",
  );
  assertEqual(leveled.run.weapons[0]?.level, 5, "the level after the pose");
  assertEqual(
    leveled.run.weapons[0]?.cooldown,
    TAPER_TIMER,
    "the timer kept across the level pose",
  );

  await h.debug.setWeaponFire(true);
  const counted = await h.step(COUNTED_TICKS);
  assertNear(
    counted.run.weapons[0]?.cooldown ?? NaN,
    TAPER_TIMER - COUNTED_TICKS * TICK_DT,
    TIMER_TOL,
    `the timer after ${COUNTED_TICKS} counted ticks`,
  );
});
