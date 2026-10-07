// instrumentation/set-level — `setLevel(4)` on playing reads back level 4
// with xpToNext 35 and leaves xp exactly as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setLevel`: "Sets
// `level` to `level`, a whole number of at least `1`. `xp` is untouched"; the
// "Derived from" table: `xpToNext` is "`XP_BASE` (`5`) `+ XP_STEP` (`10`) `×
// (level − 1)`", 35 at level 4.
//
// THE POSE. An isolated run with xp posed to a figure a level-up rule would
// have moved, then the level, read back without a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { xpToNext } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const LEVEL = 4;
const HELD_XP = 2.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the level and derives xpToNext, xp untouched", async () => {
  isolate(h, { level: 1 });
  h.debug.setXp(HELD_XP);

  h.debug.setLevel(LEVEL);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "posed");

  assertEqual(s.run.level, LEVEL, "level read back");
  assertEqual(s.run.xpToNext, xpToNext(LEVEL), "xpToNext at the posed level");
  assertEqual(s.run.xp, HELD_XP, "xp across the pose");
});
