// Wick — screens/almanac-scroll-resets-on-wrap: the wrap from the last entry
// back to the first returns the list to its top row.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`": "`up`
// and `down` move `menuIndex` by one over the tab's entries and wrap at both
// ends", and "`almanacScroll` follows the highlight: after every move of
// `menuIndex` it becomes the lesser of `almanacScroll` and `menuIndex`, then
// the greater of that and `menuIndex − ALMANAC_ROWS + 1`". A wrap is a move of
// `menuIndex` like any other, and at `menuIndex` `0` the lesser of the window
// and `0` is `0`, which the clause after it cannot raise.
//
// WHY THIS IS ITS OWN POINT. The HIGHLIGHT's wrap is
// `almanac-entry-wraps-at-bottom`'s and the window's return under a walk back up
// the list is `almanac-scroll-clamped-at-top`'s. A build that wraps the
// highlight and leaves the window at the end of the list draws the first entry
// highlighted off rows it is not among, keeping both of those points.
//
// WHAT IS READ. `menuIndex` and `almanacScroll` after the wrapping press. The
// window is read off its top row before that press, because a wrap from a list
// that never scrolled would decide nothing.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, one
// `ArrowDown` press per entry short of the last, and one more.
//
// THE TOLERANCE. None: two whole indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_TOOL_IDS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { moveEntry } from "./almanac";

/** How many entries the tab the almanac opens on lists. */
const COUNT = ALMANAC_TOOL_IDS.length;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 with almanacScroll 0 on the down that wraps", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the keys are pressed on");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on, TOOLS");

  const last = await moveEntry(h, COUNT - 1);
  assertEqual(last.menuIndex, COUNT - 1, "menuIndex at the end of the walk");
  assertGreaterThan(
    last.almanacScroll,
    0,
    "the list's first visible row after the walk down",
  );

  const wrapped = await moveEntry(h, 1);
  captureStill(h, "wrapped");

  assertEqual(wrapped.menuIndex, 0, "menuIndex after the wrapping press");
  assertEqual(
    wrapped.almanacScroll,
    0,
    "the list's first visible row after the wrap (specs/ui.md, almanac)",
  );
});
