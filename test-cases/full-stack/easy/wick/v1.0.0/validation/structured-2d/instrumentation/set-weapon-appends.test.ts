// Wick — instrumentation/set-weapon-appends: with Taper alone held,
// `setWeapon(1, 'ember', 3)` reads back Taper then Ember at level 3 with
// cooldown 0.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// loadout": "a placement in slot `weapons.length` appends"; `setWeapon(slot,
// id, level)`: "Puts weapon `id` ... at `level` in `slot`. `slot` is `0` to
// `weapons.length`"; "When the slot's `id` changes its cooldown timer becomes
// `0`".
//
// THE POSE. An isolated run with Taper kept, the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  FRESH_WEAPONS,
  captureStill,
  createHarness,
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

it("appends Ember at level 3 after Taper", async () => {
  const start = isolate(h, { taper: true });
  assertDeepEqual(start.run.weapons, FRESH_WEAPONS, "weapons before the pose");

  h.debug.setWeapon(1, "ember", 3);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "appended");
  assertDeepEqual(
    after.run.weapons,
    [...FRESH_WEAPONS, { id: "ember", level: 3, cooldown: 0 }],
    "weapons after setWeapon(1, 'ember', 3)",
  );
});
