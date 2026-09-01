// Wick — instrumentation/set-passive-rejects-held-id: with Bellows in slot 0,
// `setPassive(1, "bellows", 1)` throws and leaves the passives as they were.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setPassive(slot, id, level)`): "An `id` held in another slot is invalid";
// "the call throws rather than guessing what was meant".
//
// WHY THE WORLD IS POSED AS IT IS. One held passive and a call that names the
// appending slot with the same id, so a build that appended a duplicate or
// moved the slot changes the list, which is read exactly across the refused
// call.

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

it("throws on an id held in another slot and leaves the passives as they were", async () => {
  await isolate(h);
  await h.debug.setPassive(0, "bellows", 1);
  const before = await h.snapshot();

  await assertRejects(() => h.debug.setPassive(1, "bellows", 1), "setPassive(1, 'bellows', 1) with Bellows in slot 0");
  const after = await h.snapshot();
  await captureStill(h, "refused");
  assertDeepEqual(after.run.passives, before.run.passives, "the passives after the refused call");
});
