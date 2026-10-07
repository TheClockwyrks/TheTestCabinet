// screens/almanac-scroll-resets-on-wrap — the wrap from the last entry back to
// the first returns the list to its top row.
//
// WHAT THIS DECIDES. One thing: the `down` that wraps `menuIndex` from the last
// entry to `0` also takes `almanacScroll` back to `0`. That the HIGHLIGHT wraps
// is `almanac-entry-wraps-at-bottom`'s, and that a walk back up the list returns
// the window is `almanac-scroll-clamped-at-top`'s. A build that wraps the
// highlight and leaves the window at the end of the list draws the first entry
// highlighted off rows it is not among, and keeps both of those points.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`up` and `down` move `menuIndex` by one over the
//   tab's entries and wrap at both ends."
//   specs/ui.md (`almanac`): "`almanacScroll` follows the highlight: after
//   every move of `menuIndex` it becomes the lesser of `almanacScroll` and
//   `menuIndex`, then the greater of that and `menuIndex − ALMANAC_ROWS + 1`."
//   The wrap is a move like any other, and at `menuIndex` `0` the lesser of the
//   window and `0` is `0`, which the clause after it cannot raise.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, one `ArrowDown` press
// per entry short of the last, and one more. The window is asserted off its top
// row before that last press, because a wrap from a list that never scrolled
// would decide nothing.
//
// THE TOLERANCE. None: two whole indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ENTRIES } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { DOWN_KEY, tapTimes } from "./almanac";

/** How many entries the tab the almanac opens on lists. */
const COUNT = ALMANAC_ENTRIES.TOOLS.length;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 with almanacScroll 0 on the down that wraps", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");
  assertEqual(posed.almanacTab, 0, "the tab the list is walked on");

  const last = await tapTimes(h, DOWN_KEY, COUNT - 1);
  assertEqual(last.menuIndex, COUNT - 1, "the last entry the walk reached");
  assertGreaterThan(
    last.almanacScroll,
    0,
    "the list's first visible row after the walk down",
  );

  const wrapped = await tapTimes(h, DOWN_KEY, 1);
  captureStill(h, "wrapped");

  assertEqual(wrapped.menuIndex, 0, "the entry the wrapping press highlighted");
  assertEqual(
    wrapped.almanacScroll,
    0,
    "the list's first visible row after the wrap (specs/ui.md, almanac)",
  );
});
