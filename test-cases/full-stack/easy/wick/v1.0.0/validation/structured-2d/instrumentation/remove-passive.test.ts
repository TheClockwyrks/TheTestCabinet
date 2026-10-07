// Wick — instrumentation/remove-passive: with Bellows, Brass, and Lure held,
// `removePassive(1)` reads back Bellows then Lure, `armor` 0 from the next
// read.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// loadout": "a removal moves the slots after it up by one";
// `removePassive(slot)`: "Removes the passive in `slot`"; the derived table:
// `armor` is `BRASS_ARMOR_PER_LEVEL × the Brass level held`, 0 with none.
//
// THE POSE. An isolated run with the three placed (Brass at 2 so `armor` is
// off 0 before the call), the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { armorOf } from "../constants";
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

it("closes the gap and derives armor 0", async () => {
  isolate(h);
  holdPassive(h, "bellows", 1);
  holdPassive(h, "brass", 2);
  holdPassive(h, "lure", 3);
  assertEqual(h.snapshot().run.armor, armorOf(2), "armor before the removal");

  h.debug.removePassive(1);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "closed");
  assertDeepEqual(
    after.run.passives,
    [
      { id: "bellows", level: 1 },
      { id: "lure", level: 3 },
    ],
    "passives after removePassive(1)",
  );
  assertEqual(after.run.armor, 0, "run.armor from the next read");
});
