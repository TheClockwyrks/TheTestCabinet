// Wick — instrumentation/remove-weapon-contiguous: with Taper, Ember, and Pin
// held, `removeWeapon(1)` reads back Taper then Pin, Pin's level and cooldown
// carried into slot 1.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// loadout": "`weapons` and `passives` stay contiguous ... a removal moves the
// slots after it up by one"; `removeWeapon(slot)`: "Removes the weapon in
// `slot`".
//
// THE POSE. An isolated run with Taper kept, Ember at 2 and Pin at 4 appended,
// Pin's timer posed to 0.3 so the carried slot is told by more than its id;
// the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  FRESH_WEAPONS,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";

const PIN_COOLDOWN = 0.3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("closes the gap, carrying Pin's level and cooldown into slot 1", async () => {
  isolate(h, { taper: true });
  holdWeapon(h, "ember", 2);
  const pin = holdWeapon(h, "pin", 4);
  h.debug.setWeaponCooldown(pin, PIN_COOLDOWN);

  h.debug.removeWeapon(1);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "closed");
  assertDeepEqual(
    after.run.weapons,
    [...FRESH_WEAPONS, { id: "pin", level: 4, cooldown: PIN_COOLDOWN }],
    "weapons after removeWeapon(1)",
  );
});
