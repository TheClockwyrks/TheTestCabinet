// progression/xp-to-next-formula — xpToNext is XP_BASE + XP_STEP × (level − 1).
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Levels and
// experience") fixes the two figures — "Experience to leave level 1 | `XP_BASE`
// | `5`" and "Increase per level | `XP_STEP` | `10`" — and the formula:
// "xpToNext(level) = XP_BASE + XP_STEP × (level - 1)". Its table states the
// four readings this check takes: level 1 → 5, level 2 → 15, level 5 → 45,
// level 10 → 95. specs/instrumentation.md reports the figure on the snapshot:
// "`xpToNext` | `XP_BASE + XP_STEP × (level − 1)`".
//
// WHY THE WORLD IS POSED AS IT IS. Nothing but the level bears on the reading,
// so the night is isolated with every faculty held and nothing alive, and the
// level is posed with `setLevel`, which "Sets `level` to `level` ... `xp` is
// untouched". The four levels are the two ends and two interior points of the
// specification's own table, so a build with the intercept or the slope wrong
// fails at least one of them.
//
// THE TOLERANCE. None: each of the four is a whole number the table states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { xpToNext } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The levels the specification's table is read at: its ends and two interior rows. */
const LEVELS = [1, 2, 5, 10] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads 5 at level 1, 15 at level 2, 45 at level 5, and 95 at level 10", async () => {
  await isolate(h);

  const read: number[] = [];
  for (const level of LEVELS) {
    await h.debug.setLevel(level);
    const posed = await h.snapshot();
    assertEqual(posed.run.level, level, "the level the pose left");
    read.push(posed.run.xpToNext);
  }
  await captureStill(h, "curve");

  for (const [index, level] of LEVELS.entries()) {
    assertEqual(read[index], xpToNext(level), `xpToNext at level ${level}`);
  }
});
