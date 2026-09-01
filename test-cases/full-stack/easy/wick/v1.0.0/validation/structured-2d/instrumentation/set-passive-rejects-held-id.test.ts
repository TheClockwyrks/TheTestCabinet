// Wick — instrumentation/set-passive-rejects-held-id: with Bellows in slot 0,
// `setPassive(1, 'bellows', 1)` throws and leaves the passives as they were.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setPassive(slot, id, level)`: "An `id` held in another slot is invalid";
// an invalid argument throws.
//
// THE POSE. An isolated run with Bellows placed, the call, and the whole
// snapshot compared with the one before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
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

it("throws for a passive held in another slot and changes nothing", async () => {
  isolate(h);
  holdPassive(h, "bellows", 1);
  const before = h.snapshot();

  assertThrows(
    () => h.debug.setPassive(1, "bellows", 1),
    "setPassive(1, 'bellows', 1) with Bellows in slot 0",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(
    after.run.passives,
    before.run.passives,
    "passives after the refused call",
  );
  assertDeepEqual(after, before, "snapshot after the refused call");
});
