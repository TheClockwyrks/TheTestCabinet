// Wick — instrumentation/set-weapon-timer-zero-on-change: with Taper's
// cooldown counting at 1.0, `setWeapon(0, "pin", 1)` reads back cooldown 0 and
// Pin fires on the next `playing` tick.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setWeapon(slot, id, level)`): "When the slot's `id` changes its cooldown
// timer becomes `0`". specs/weapons.md: "a timer at `0` stays due" and "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick
// it is held"; Pin "fires whether or not any enemy exists".
//
// WHY THE WORLD IS POSED AS IT IS. Taper's timer is posed to a full second
// first, so a build that carried the old timer across the change would read
// 1.0 and fire nothing on the next tick; `weaponFire` is turned on for that one
// tick alone, so what the tick creates is Pin's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  newProjectiles,
  type Harness,
} from "../harness";

const TAPER_TIMER = 1.0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("zeroes the timer when the slot's id changes, so the new weapon fires next tick", async () => {
  await isolate(h, { keepTaper: true });
  await h.debug.setWeaponCooldown(0, TAPER_TIMER);
  assertEqual((await h.snapshot()).run.weapons[0]?.cooldown, TAPER_TIMER, "Taper's timer before the change");

  await h.debug.setWeapon(0, "pin", 1);
  const changed = await h.snapshot();
  await captureStill(h, "zeroed");
  assertEqual(changed.run.weapons[0]?.id, "pin", "the weapon in slot 0 after the change");
  assertEqual(changed.run.weapons[0]?.cooldown, 0, "the timer after the id changed");

  await h.debug.setWeaponFire(true);
  const fired = await h.step(1);
  const darts = newProjectiles(changed, fired).filter((shape) => shape.weapon === "pin");
  assertGreaterThan(darts.length, 0, "Pin darts fired on the next playing tick");
});
