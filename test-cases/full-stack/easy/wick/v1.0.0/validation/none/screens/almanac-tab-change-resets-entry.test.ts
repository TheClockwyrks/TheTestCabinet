// screens/almanac-tab-change-resets-entry — a tab change returns the list to its
// first entry, and the window to its top.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`left` and
// `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends, and
// set `menuIndex` and `almanacScroll` to `0`."
//
// WHY THE WORLD IS POSED AS IT IS. The change has to be made from a list that is
// BOTH off its first entry and scrolled, or a build that reset one of the two
// and not the other would pass. So the `TOOLS` tab is walked to its thirteenth
// entry with real `ArrowDown` presses, which specs/ui.md's scroll rule carries
// the window down with — "`almanacScroll` follows the highlight ... the greater
// of that and `menuIndex − ALMANAC_ROWS + 1`" — and both fields are read back
// before the tab change, so a build whose `down` or whose scroll is broken fails
// the point that owns it rather than this one. Every press is a REAL key through
// Chromium's input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: two indices are exact comparisons. The precondition asks
// only that the window has left its top, because how far it moved is
// `almanac-scroll-follows-highlight`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openAlmanac, poseEntry, pressRight } from "./almanac";

/** The entry the list is walked to: past the tenth row, so the window moves. */
const SCROLLED_ENTRY = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 0 and almanacScroll 0 after ArrowRight from a scrolled list", async () => {
  await openAlmanac(h);
  const posed = await poseEntry(h, SCROLLED_ENTRY);
  assertEqual(
    posed.menuIndex,
    SCROLLED_ENTRY,
    "the entry the change is made from",
  );
  assertGreaterThan(
    posed.almanacScroll,
    0,
    "the window the walked highlight carried off the top of the list",
  );

  const after = await pressRight(h);
  await captureStill(h, "reset");

  assertEqual(after.screen, "almanac", "the screen after ArrowRight");
  assertEqual(
    after.almanacTab,
    1,
    "almanacTab after ArrowRight, which is what a tab change is",
  );
  assertEqual(after.menuIndex, 0, "menuIndex after a tab change (specs/ui.md)");
  assertEqual(
    after.almanacScroll,
    0,
    "almanacScroll after a tab change (specs/ui.md)",
  );
});
