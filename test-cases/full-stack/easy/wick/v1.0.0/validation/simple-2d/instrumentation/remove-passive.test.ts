// instrumentation/remove-passive — with Bellows, Brass, and Lure held,
// `removePassive(1)` reads back passives as Bellows then Lure, armor 0 from
// the next read.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The loadout": "a
// removal moves the slots after it up by one"; `removePassive`: "Removes the
// passive in `slot`, a held slot"; the "Derived from" table: `armor` is
// "`BRASS_ARMOR_PER_LEVEL` (`1`) `×` the Brass level held", and "A passive
// not held counts as level `0`".
//
// THE POSE. An isolated run with the three passives, the removal of the
// middle one, the read back without a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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

it("closes the gap and drops the armor Brass gave", async () => {
  isolate(h);
  holdPassive(h, "bellows", 2);
  holdPassive(h, "brass", 3);
  holdPassive(h, "lure", 1);
  assertEqual(h.snapshot().run.armor, 3, "armor with Brass 3 held");

  h.debug.removePassive(1);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "closed");

  assertDeepEqual(
    s.run.passives,
    [
      { id: "bellows", level: 2 },
      { id: "lure", level: 1 },
    ],
    "passives after the removal",
  );
  assertEqual(s.run.armor, 0, "armor from the next read");
});
