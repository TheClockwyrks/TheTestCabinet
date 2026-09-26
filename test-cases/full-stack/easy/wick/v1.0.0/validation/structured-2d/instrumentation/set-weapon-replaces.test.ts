// Wick — instrumentation/set-weapon-replaces: with Taper in slot 0,
// `setWeapon(0, 'pin', 2)` reads back Pin at level 2 in slot 0 and no Taper
// anywhere.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setWeapon(slot, id, level)`: "Puts weapon `id` ... at `level` in `slot`"
// — a held slot takes the new weapon in the old one's place — and "When the
// slot's `id` changes its cooldown timer becomes `0`".
//
// THE POSE. An isolated run with Taper kept, the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  FRESH_WEAPONS,
  captureStill,
  createHarness,
  isolate,
  weaponSlotOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("replaces Taper with Pin at level 2 in slot 0", async () => {
  const start = isolate(h, { taper: true });
  assertDeepEqual(start.run.weapons, FRESH_WEAPONS, "weapons before the pose");

  h.debug.setWeapon(0, "pin", 2);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "replaced");
  assertDeepEqual(
    after.run.weapons,
    [{ id: "pin", level: 2, cooldown: 0 }],
    "weapons after setWeapon(0, 'pin', 2)",
  );
  assertEqual(
    weaponSlotOf(after, "taper"),
    -1,
    "the slot holding Taper after the replacement",
  );
});
