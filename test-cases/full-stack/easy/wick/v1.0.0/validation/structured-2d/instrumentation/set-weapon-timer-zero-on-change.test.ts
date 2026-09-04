// Wick — instrumentation/set-weapon-timer-zero-on-change: with Taper's
// cooldown at 1.0, `setWeapon(0, 'pin', 1)` reads back cooldown 0 and Pin
// fires on the next `playing` tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setWeapon(slot, id, level)`: "When the slot's `id` changes its cooldown
// timer becomes `0`". `specs/weapons.md`, "Cooldown timers": a timer at 0 is
// due, "so a weapon fires on the first `playing` tick it is held"; Pin "fires
// whether or not any enemy exists", one dart at level 1.
//
// THE DRIVE. An isolated run with Taper kept and its timer posed to 1.0, the
// call read at the call, then `weaponFire` on and one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { PIN_LEVELS } from "../constants";
import {
  advanceTicks,
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
  h.dispose();
});

it("zeroes the timer on an id change so the new weapon fires at once", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setWeaponCooldown(0, COUNTING);
  assertEqual(
    h.snapshot().run.weapons[0]?.cooldown,
    COUNTING,
    "Taper's timer before the change",
  );

  h.debug.setWeapon(0, "pin", 1);
  const changed = h.snapshot();
  assertEqual(
    changed.run.weapons[0]?.id,
    "pin",
    "the weapon in slot 0 after the change",
  );
  assertEqual(
    changed.run.weapons[0]?.cooldown,
    0,
    "the timer after the id changed",
  );

  enable(h, "weaponFire");
  const fired = await advanceTicks(h, 1);
  captureStill(h, "zeroed");
  assertLength(
    projectilesOf(fired, "pin"),
    PIN_LEVELS[0].amount,
    "Pin darts on the next playing tick",
  );
});
