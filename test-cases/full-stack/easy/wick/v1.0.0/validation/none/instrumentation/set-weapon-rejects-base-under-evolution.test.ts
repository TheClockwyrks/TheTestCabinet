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
import { assertDeepEqual, assertRejects } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on Taper beside Pyre", async () => {
  await isolate(h);
  await h.debug.setWeapon(0, "pyre", 1);
  const before = await h.snapshot();

  await assertRejects(
    () => h.debug.setWeapon(1, "taper", 1),
    "setWeapon(1, 'taper', 1) with Pyre held",
  );
  await captureStill(h, "refused");

  assertDeepEqual(
    (await h.snapshot()).run.weapons,
    before.run.weapons,
    "the weapons after the refused call",
  );
});
