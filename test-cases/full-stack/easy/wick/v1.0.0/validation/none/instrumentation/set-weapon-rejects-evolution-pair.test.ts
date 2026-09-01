// Wick — instrumentation/set-weapon-rejects-evolution-pair: with Pyre held in
// slot 0, `setWeapon(1, "taper", 1)` throws; with Taper held in slot 0,
// `setWeapon(1, "pyre", 1)` throws; each leaves the loadout as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setWeapon(slot, id, level)`): "Invalid: ... a base weapon whose evolution
// is held in another slot; an evolved weapon whose base is held in another
// slot"; "the call throws rather than guessing what was meant".
// specs/evolutions.md: Pyre is Taper's evolution.
//
// WHY THE WORLD IS POSED AS IT IS. Both directions of the pair, each from a
// loadout holding only the other half, so a build that checks one direction
// alone fails the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import {
  captureStill,
  createHarness,
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

it("throws on a base whose evolution is held, and on an evolution whose base is held", async () => {
  await isolate(h);
  await h.debug.setWeapon(0, "pyre", 1);
  const withPyre = await h.snapshot();
  await assertRejects(() => h.debug.setWeapon(1, "taper", 1), "setWeapon(1, 'taper', 1) with Pyre held");
  assertDeepEqual(
    (await h.snapshot()).run.weapons,
    withPyre.run.weapons,
    "the weapons after the refused Taper",
  );

  await isolate(h);
  await h.debug.setWeapon(0, "taper", 1);
  const withTaper = await h.snapshot();
  await assertRejects(() => h.debug.setWeapon(1, "pyre", 1), "setWeapon(1, 'pyre', 1) with Taper held");
  const after = await h.snapshot();
  await captureStill(h, "refused");
  assertDeepEqual(after.run.weapons, withTaper.run.weapons, "the weapons after the refused Pyre");
});
