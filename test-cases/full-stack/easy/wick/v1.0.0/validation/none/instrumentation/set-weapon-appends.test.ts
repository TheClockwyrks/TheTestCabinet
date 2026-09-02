// Wick — instrumentation/set-weapon-appends: with Taper alone held,
// `setWeapon(1, "ember", 3)` reads back `weapons` as Taper then Ember at level
// 3 with cooldown 0.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The loadout"):
// "`weapons` and `passives` stay contiguous: a placement in slot
// `weapons.length` appends"; `setWeapon(slot, id, level)`: "Puts weapon `id`
// ... at `level` in `slot`. `slot` is `0` to `weapons.length` ... When the
// slot's `id` changes its cooldown timer becomes `0`".
//
// WHY THE WORLD IS POSED AS IT IS. The fresh run's Taper is kept, so slot 1 is
// exactly `weapons.length`, the appending slot; Ember at level 3 is a figure a
// build defaulting the level to 1 would miss.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  FRESH_TAPER,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends a weapon in the next slot", async () => {
  const posed = await isolate(h, { keepTaper: true });
  assertDeepEqual(
    posed.run.weapons,
    [FRESH_TAPER],
    "the weapons before the pose",
  );

  await h.debug.setWeapon(1, "ember", 3);
  const after = await h.snapshot();
  await captureStill(h, "appended");
  assertDeepEqual(
    after.run.weapons,
    [FRESH_TAPER, { id: "ember", level: 3, cooldown: 0 }],
    "the weapons after setWeapon(1, 'ember', 3)",
  );
});
