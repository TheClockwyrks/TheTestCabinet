// instrumentation/set-weapon-rejects-held-id — with Taper in slot 0 and Ember
// in slot 1, `setWeapon(1, 'taper', 1)` throws and leaves both slots as they
// were.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setWeapon`:
// "Invalid: an `id` already held in another slot"; an invalid argument "throws
// rather than guessing what was meant".
//
// THE POSE. An isolated run keeping its Taper, Ember appended, the refused
// call, and the whole snapshot against the reading before.

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
  h?.dispose();
});

it("refuses an id held in another slot", async () => {
  isolate(h, { keepTaper: true });
  holdWeapon(h, "ember", 1);
  const before = h.snapshot();
  assertDeepEqual(
    before.run.weapons.map((w) => w.id),
    ["taper", "ember"],
    "the slots",
  );

  assertThrows(
    () => h.debug.setWeapon(1, "taper", 1),
    "setWeapon(1, 'taper', 1)",
  );
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "refused");

  assertDeepEqual(s, before, "the snapshot across the refused pose");
});
