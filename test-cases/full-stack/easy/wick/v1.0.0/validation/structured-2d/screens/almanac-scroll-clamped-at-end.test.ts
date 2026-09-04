// Wick — screens/almanac-scroll-clamped-at-end: the list stops at its last
// window of rows when the highlight reaches the last entry.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`almanacScroll` follows the highlight: after every move of `menuIndex` it
// becomes the lesser of `almanacScroll` and `menuIndex`, then the greater of
// that and `menuIndex − ALMANAC_ROWS + 1`, and is then held between `0` and
// `max(0, count − ALMANAC_ROWS)`, for `count` the number of entries the tab
// holds." On the last entry, `menuIndex − ALMANAC_ROWS + 1` is exactly
// `count − ALMANAC_ROWS`, so the window stands on its last row.
//
// WHY THIS IS ITS OWN POINT. `almanac-scroll-clamped-at-top` decides the lower
// bound and `pointer/almanac-wheel-clamped` decides this same upper bound by
// the wheel's route. A build whose keyboard walk runs the window off the end of
// the list keeps both and misses this one.
//
// WHAT IS READ. `menuIndex` and `almanacScroll` after the walk. The entry is
// read as the check's precondition, so a build whose `down` is broken fails the
// point that owns it.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, and one
// `ArrowDown` press per entry short of the last, so the walk stops on the final
// entry of the tools tab without wrapping.
//
// THE TOLERANCE. None: a whole row index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS, ALMANAC_TOOL_IDS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { moveEntry } from "./almanac";

/** How many entries the tab the almanac opens on lists. */
const COUNT = ALMANAC_TOOL_IDS.length;

/** `max(0, count − ALMANAC_ROWS)` for that tab (specs/ui.md). */
const LAST_WINDOW = Math.max(0, COUNT - ALMANAC_ROWS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads almanacScroll at the last window with the highlight on the last entry", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the keys are pressed on");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on, TOOLS");

  const down = await moveEntry(h, COUNT - 1);
  captureStill(h, "end");

  assertEqual(down.menuIndex, COUNT - 1, "menuIndex at the end of the walk");
  assertEqual(
    down.almanacScroll,
    LAST_WINDOW,
    "the list's first visible row with the highlight on the last entry (specs/ui.md, almanac)",
  );
});
