// progression/xp-to-next-formula — the experience needed to leave a level is
// XP_BASE + XP_STEP × (level − 1), read at four levels.
//
// THE FORMULA, FROM THE SPEC. specs/progression.md, Levels and experience:
// "The experience needed to leave a level is: xpToNext(level) = XP_BASE +
// XP_STEP × (level - 1)", with XP_BASE (5) and XP_STEP (10) in the table above
// it. The table below it lists the value at every level of the first ten, 5 at
// level 1, 15 at level 2, 45 at level 5, and 95 at level 10 among them.
// specs/instrumentation.md, Snapshot shape, derives the reported field the same
// way: "xpToNext | XP_BASE (5) + XP_STEP (10) × (level − 1)".
//
// THE POSE. An isolated night: nothing on the field, nothing held, and every
// driver switch off, so no gem, kill, or gain moves the level between the pose
// and the read. Each level is posed through setLevel, which "Sets level to
// level, a whole number of at least 1. xp is untouched"
// (specs/instrumentation.md), and the reading is taken from the snapshot with
// no tick run: xpToNext is derived from level alone.
//
// THE TOLERANCE. None. The four figures are whole numbers, and the formula is
// a sum of two exact integers at every level, so a compliant build reads each
// exactly. A build carrying a different base or step misses by 10 or more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { xpToNext } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The four levels the point reads, with the value the spec's table gives. */
const CURVE: readonly (readonly [number, number])[] = [
  [1, 5],
  [2, 15],
  [5, 45],
  [10, 95],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads xpToNext 5 at level 1, 15 at level 2, 45 at level 5, and 95 at level 10", async () => {
  isolate(h);

  const read: number[] = [];
  for (const [level] of CURVE) {
    h.debug.setLevel(level);
    read.push(h.snapshot().run.xpToNext);
  }
  await h.frameDraw();
  captureStill(h, "curve");

  CURVE.forEach(([level, expected], index) => {
    // The table's figure and the formula's agree at every level the spec lists.
    assertEqual(xpToNext(level), expected, `the curve at level ${level}`);
    assertEqual(read[index], expected, `xpToNext reported at level ${level}`);
  });
});
