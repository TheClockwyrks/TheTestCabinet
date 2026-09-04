// Wick — audio/hum-stops-on-remove: with Halo held and `hum` looping, removing
// Halo leaves `hum` not looping on the next frame.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`hum` is looping on every frame exactly when
//     `screen` is `playing` and a held weapon is `halo` or `corona` ... and it
//     stops on the frame either stops being true", and "Both loops are
//     reconciled from the state on every frame".
//   - specs/instrumentation.md (`removeWeapon`): "Removes the weapon in
//     `slot`, a held slot. Its aura or lantern set is removed on the next
//     `playing` tick under the placement rule"; a pose "sounds nothing", so the
//     loop stops from the frame after and never from the call.
//
// WHAT IS READ. `looping("hum")` with Halo held, which is `true`, and again one
// frame after the slot was emptied, which is `false`. The first reading is
// named by the requirement itself, "With Halo held and `hum` looping", and is
// what makes the second a stop.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field
// and every driver switch off, holding Halo alone, and one tick first so the
// loop is running before the removal. The screen never leaves `playing`, so the
// only term of the loop's condition that changes is the held weapon, which is
// the one this point is about; leaving `playing` is its own point.
//
// TOLERANCE. None. Both readings are booleans.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stops the hum on the frame after Halo leaves the loadout", async () => {
  isolate(h);
  const slot = holdWeapon(h, "halo", 1);
  await h.tick(1);
  assertEqual(h.looping("hum"), true, "hum looping with Halo held");

  h.debug.removeWeapon(slot);
  const after = await captureReplay(h, "stopped", () => h.tick(1));

  assertEqual(
    after.run.weapons.length,
    0,
    "the weapons held after the removal",
  );
  assertEqual(after.screen, "playing", "the screen across the removal");
  assertEqual(
    h.looping("hum"),
    false,
    "hum looping on the frame after Halo was removed",
  );
});
