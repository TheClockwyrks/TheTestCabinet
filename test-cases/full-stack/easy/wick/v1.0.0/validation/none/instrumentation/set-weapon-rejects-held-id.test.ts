// Wick — instrumentation/set-weapon-rejects-held-id: with Taper in slot 0 and
// Ember in slot 1, `setWeapon(1, "taper", 1)` throws and leaves both slots as
// they were.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setWeapon(slot, id, level)`): "Invalid: an `id` already held in another
// slot"; "the call throws rather than guessing what was meant".
//
// WHY THE WORLD IS POSED AS IT IS. Two held slots, and the call names slot 1
// with slot 0's id, so a build that moved Taper, duplicated it, or replaced
// Ember would each change the loadout, which is read exactly across the
// refused call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on an id held in another slot and leaves the loadout as it was", async () => {
  await isolate(h, { keepTaper: true });
  await h.debug.setWeapon(1, "ember", 1);
  const before = await h.snapshot();

  await assertRejects(
    () => h.debug.setWeapon(1, "taper", 1),
    "setWeapon(1, 'taper', 1) with Taper in slot 0",
  );
  const after = await h.snapshot();
  await captureStill(h, "refused");
  assertDeepEqual(
    after.run.weapons,
    before.run.weapons,
    "the weapons after the refused call",
  );
});
