// Wick — instrumentation/set-weapon-rejects-held-id: with Taper in slot 0
// and Ember in slot 1, `setWeapon(1, 'taper', 1)` throws and leaves both
// slots as they were.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setWeapon(slot, id, level)`: "Invalid: an `id` already held in another
// slot"; an invalid argument "throws rather than guessing what was meant".
//
// THE POSE. An isolated run with Taper kept and Ember appended, the call, and
// the whole snapshot compared with the one before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import {
  captureStill,
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

it("throws for an id held in another slot and changes nothing", async () => {
  isolate(h, { keepTaper: true });
  holdWeapon(h, "ember");
  const before = h.snapshot();

  assertThrows(
    () => h.debug.setWeapon(1, "taper", 1),
    "setWeapon(1, 'taper', 1) with Taper in slot 0",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(
    after.run.weapons,
    before.run.weapons,
    "weapons after the refused call",
  );
  assertDeepEqual(after, before, "snapshot after the refused call");
});
