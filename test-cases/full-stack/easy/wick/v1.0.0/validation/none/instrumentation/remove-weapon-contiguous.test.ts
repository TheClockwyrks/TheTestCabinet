// Wick — instrumentation/remove-weapon-contiguous: with Taper, Ember, and Pin
// held, `removeWeapon(1)` reads back `weapons` as Taper then Pin, Pin's level
// and cooldown carried into slot 1.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The loadout"):
// "`weapons` and `passives` stay contiguous: ... a removal moves the slots
// after it up by one"; `removeWeapon(slot)`: "Removes the weapon in `slot`, a
// held slot."
//
// WHY THE WORLD IS POSED AS IT IS. Three weapons with the middle one removed,
// so the slot after it must move up; Pin is given a level and a timer that are
// not the defaults, so what moves up is Pin's own slot and not a fresh one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const PIN_LEVEL = 3;
const PIN_TIMER = 0.7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes the gap a removal leaves", async () => {
  await isolate(h);
  await h.debug.setWeapon(0, "taper", 1);
  await h.debug.setWeapon(1, "ember", 2);
  await h.debug.setWeapon(2, "pin", PIN_LEVEL);
  await h.debug.setWeaponCooldown(2, PIN_TIMER);

  await h.debug.removeWeapon(1);
  const after = await h.snapshot();
  await captureStill(h, "closed");
  assertDeepEqual(
    after.run.weapons,
    [
      { id: "taper", level: 1, cooldown: 0 },
      { id: "pin", level: PIN_LEVEL, cooldown: PIN_TIMER },
    ],
    "the weapons after removeWeapon(1)",
  );
});
