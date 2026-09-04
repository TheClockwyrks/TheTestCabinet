// progression/level-clears-on-last-segment — removing the last segment clears
// the level.
//
// specs/progression.md, Clearing a level: a level clears on the step in which
// the last of its worm segments is REMOVED. This is the first of the rule's two
// directions — that a real removal of the last segment does clear the level —
// and `empty-board-does-not-clear` is the other, that a board which never held
// one does not.
//
// THE REMOVAL IS DRIVEN, NOT POSED. The clear is the removal itself, so it
// cannot be arranged by hand: `clearLastSegment` poses a one-segment worm and a
// bolt in its column, and the build's own shot code and cut rule do the
// removing. What is read is the frame that removal landed on.
//
// WHAT IS ASSERTED IS THE TRANSITION, NOT THE ARITHMETIC. The run must be past
// the level it was on. By how much is `level-advances`'s point, and which screen
// the twelfth level opens is `victory-on-twelve`'s, so a build that clears but
// miscounts is docked once, there.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { clearLastSegment } from "./clear";

/**
 * The level cleared. Any level below `TOTAL_LEVELS` (`12`) would do — the run
 * has to have somewhere to advance TO, and the twelfth level opens the victory
 * screen instead (specs/progression.md).
 */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the run past the level whose last segment was removed", async () => {
  const cleared = await clearLastSegment(h, LEVEL);

  // One frame past the clear, so the picture kept is the run the clear opened
  // rather than the last frame of the shot that reached it. The reading below is
  // `cleared`, taken on the frame of the removal, so this decides nothing.
  await h.advance(1);
  captureStill(h, "cleared");

  assertGreaterThan(
    cleared.level,
    LEVEL,
    "the level the run stands on once the last segment is removed",
  );
});
