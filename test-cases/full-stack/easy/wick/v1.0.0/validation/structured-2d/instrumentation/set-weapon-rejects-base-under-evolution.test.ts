// Wick — instrumentation/set-weapon-rejects-base-under-evolution: with Pyre
// held in slot 0, `setWeapon(1, "taper", 1)` throws and leaves the loadout as
// it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setWeapon(slot,
// id, level)`): "Invalid: ... a base weapon whose evolution is held in another
// slot; an evolved weapon whose base is held in another slot"; "the call
// throws rather than guessing what was meant". specs/evolutions.md: Pyre is
// Taper's evolution. This point takes a base weapon whose evolution is held in
// another slot; the other direction is the sibling point.
//
// WHY THE WORLD IS POSED AS IT IS. The loadout holds only the other half of
// the pair, so the refusal turns on the pair alone and a build that checks the
// opposite direction only fails here.

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

it("throws on Taper beside Pyre", async () => {
  isolate(h);
  holdWeapon(h, "pyre", 1);
  const before = h.snapshot();

  assertThrows(
    () => h.debug.setWeapon(1, "taper", 1),
    "setWeapon(1, 'taper', 1) with Pyre in slot 0",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");

  assertDeepEqual(after, before, "the snapshot after the refused call");
});
