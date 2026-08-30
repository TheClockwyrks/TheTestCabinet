// progression/level-advances — a clear takes the run up exactly one level.
//
// specs/progression.md, Clearing a level: on a clear below `TOTAL_LEVELS` the
// level goes up BY ONE, and the level reached goes up with it. Both halves are
// one rule and one sentence, so both are read here.
//
// THE LEVEL CLEARED IS NOT 1, DELIBERATELY. Clearing level `1` cannot tell a
// build that adds one from a build that jumps to a fixed second level, or from
// one that recomputes the level out of something else; clearing level `4` and
// reading `5` can. It is also far enough below `TOTAL_LEVELS` (`12`) that the
// run has somewhere to advance to.
//
// The removal itself is driven by `clearLastSegment` — the clear is the removal
// (see `level-clears-on-last-segment`) — and the banner the new level opens on
// is `level-banner`'s point, not read here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { clearLastSegment } from "./clear";

/** The level cleared, and the one the run must stand on afterwards. */
const LEVEL = 4;
const NEXT_LEVEL = LEVEL + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the next level, and the level reached with it", async () => {
  const cleared = await clearLastSegment(h, LEVEL);

  // One frame past the clear, so the picture kept is the HUD of the level the
  // clear opened. The reading below is `cleared`, so this decides nothing.
  await h.advance(1);
  captureStill(h, "advanced");

  assertEqual(cleared.level, NEXT_LEVEL, `the level after clearing ${LEVEL}`);
  assertEqual(
    cleared.reachedLevel,
    NEXT_LEVEL,
    `the level reached after clearing ${LEVEL}`,
  );
});
