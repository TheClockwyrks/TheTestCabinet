// instrumentation/remove-weapon-contiguous — with Taper, Ember, and Pin held,
// `removeWeapon(1)` reads back weapons as Taper then Pin, Pin's level and
// cooldown carried into slot 1.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The loadout":
// "`weapons` and `passives` stay contiguous ... a removal moves the slots
// after it up by one"; `removeWeapon`: "Removes the weapon in `slot`, a held
// slot".
//
// THE POSE. An isolated run keeping its Taper, Ember and Pin appended, Pin at
// a level and with a timer no fresh slot carries, the removal, and the read
// back without a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";

const PIN_LEVEL = 4;
const PIN_COOLDOWN = 0.3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("closes the gap, carrying Pin into slot 1", async () => {
  isolate(h, { keepTaper: true });
  holdWeapon(h, "ember", 2);
  const pin = holdWeapon(h, "pin", PIN_LEVEL);
  h.debug.setWeaponCooldown(pin, PIN_COOLDOWN);

  h.debug.removeWeapon(1);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "closed");

  assertDeepEqual(
    s.run.weapons,
    [
      { id: "taper", level: 1, cooldown: 0 },
      { id: "pin", level: PIN_LEVEL, cooldown: PIN_COOLDOWN },
    ],
    "weapons after the removal",
  );
});
