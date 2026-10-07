// instrumentation/set-passive-rejects-held-id — with Bellows in slot 0,
// `setPassive(1, 'bellows', 1)` throws and leaves the passives as they were.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setPassive`: "An
// `id` held in another slot is invalid"; an invalid argument "throws rather
// than guessing what was meant".
//
// THE POSE. An isolated run holding Bellows, the refused pose into slot 1,
// and the whole snapshot against the reading before.

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
  h?.dispose();
});

it("refuses an id held in another slot", async () => {
  isolate(h);
  holdPassive(h, "bellows", 2);
  const before = h.snapshot();

  assertThrows(
    () => h.debug.setPassive(1, "bellows", 1),
    "setPassive(1, 'bellows', 1)",
  );
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "refused");

  assertDeepEqual(s, before, "the snapshot across the refused pose");
});
