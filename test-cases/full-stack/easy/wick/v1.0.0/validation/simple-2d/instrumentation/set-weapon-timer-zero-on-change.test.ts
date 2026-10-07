// instrumentation/set-weapon-timer-zero-on-change — with Taper's cooldown
// counting at 1.0, `setWeapon(0, 'pin', 1)` reads back cooldown 0 and Pin
// fires on the next playing tick.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setWeapon`: "When
// the slot's `id` changes its cooldown timer becomes `0`". specs/weapons.md,
// "Cooldown timers": a timer at 0 is due, and "a weapon fires on the first
// `playing` tick it is held"; Pin "fires whether or not any enemy exists".
//
// THE POSE. An isolated run keeping its Taper with its timer posed to 1.0,
// the pose over slot 0, the read-back, `weaponFire` on, and one tick: a dart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  projectilesOf,
  type Harness,
} from "../harness";

const COUNTING = 1.0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("zeroes the timer when the id changes, and Pin fires at once", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setWeaponCooldown(0, COUNTING);
  assertEqual(
    h.snapshot().run.weapons[0].cooldown,
    COUNTING,
    "Taper's timer posed",
  );

  h.debug.setWeapon(0, "pin", 1);
  const s = h.snapshot();
  assertEqual(s.run.weapons[0].id, "pin", "the slot's id after the pose");
  assertEqual(
    s.run.weapons[0].cooldown,
    0,
    "the slot's timer after the id changed",
  );

  enable(h, "weaponFire");
  const fired = await h.tick(1);
  captureStill(h, "zeroed");
  assertGreaterThan(
    projectilesOf(fired, "pin").length,
    0,
    "the darts Pin fired on the next tick",
  );
});
