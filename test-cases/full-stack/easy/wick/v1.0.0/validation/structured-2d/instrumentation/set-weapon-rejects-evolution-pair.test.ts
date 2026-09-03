// Wick — instrumentation/set-weapon-rejects-evolution-pair: with Pyre held in
// slot 0, `setWeapon(1, 'taper', 1)` throws; with Taper in slot 0,
// `setWeapon(1, 'pyre', 1)` throws; each leaves the loadout as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setWeapon(slot, id, level)`: "Invalid: ... a base weapon whose evolution is
// held in another slot; an evolved weapon whose base is held in another
// slot"; `specs/evolutions.md`: Pyre is Taper's evolution. An invalid argument
// throws.
//
// THE POSES. Each half on its own isolated run; each call, and the whole
// snapshot compared with the one before it.

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

it("throws for a base beside its evolution and an evolution beside its base", async () => {
  isolate(h);
  holdWeapon(h, "pyre", 1);
  const withPyre = h.snapshot();
  assertThrows(
    () => h.debug.setWeapon(1, "taper", 1),
    "setWeapon(1, 'taper', 1) with Pyre in slot 0",
  );
  assertDeepEqual(h.snapshot(), withPyre, "snapshot after the refused Taper");

  isolate(h, { keepTaper: true });
  const withTaper = h.snapshot();
  assertThrows(
    () => h.debug.setWeapon(1, "pyre", 1),
    "setWeapon(1, 'pyre', 1) with Taper in slot 0",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(after, withTaper, "snapshot after the refused Pyre");
});
