// Wick — progression/xp-to-next-formula: the experience needed to leave a
// level is `XP_BASE + XP_STEP × (level − 1)`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "Levels and
// experience": "The experience needed to leave a level is:
// `xpToNext(level) = XP_BASE + XP_STEP × (level - 1)`", with `XP_BASE` (`5`)
// and `XP_STEP` (`10`), and the table under it reads `5` at level 1, `15` at
// level 2, `45` at level 5, and `95` at level 10.
// `specs/instrumentation.md` reports the figure as the run's `xpToNext`.
//
// THE POSE. An isolated `playing` run holding nothing with every driver switch
// off, so no gem, kill, or scripted event moves `level` or `xp` between the
// four readings. `setLevel(level)` is the only thing that changes, and
// `specs/instrumentation.md` says of it that "`xp` is untouched", so each
// reading is the formula at that level alone. The four levels are the table's
// two ends and two points between them: an affine curve of any other slope or
// intercept, and any curve that is not affine, misses at least one of them.
//
// THE TOLERANCE. Exact. `xpToNext` is a sum of two whole numbers, and the
// nearest wrong answer at any of the four levels is a whole `10` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The table of `specs/progression.md`, as `[level, xpToNext(level)]`. */
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
  h.dispose();
});

it("reads xpToNext 5, 15, 45, and 95 at levels 1, 2, 5, and 10", async () => {
  isolate(h);

  const read: number[] = [];
  for (const [level] of CURVE) {
    h.debug.setLevel(level);
    read.push(h.snapshot().run.xpToNext);
  }
  await h.frameDraw();
  captureStill(h, "curve");

  CURVE.forEach(([level, expected], index) => {
    assertEqual(
      read[index],
      expected,
      `run.xpToNext at level ${level} (specs/progression.md, Levels and experience)`,
    );
  });
});
