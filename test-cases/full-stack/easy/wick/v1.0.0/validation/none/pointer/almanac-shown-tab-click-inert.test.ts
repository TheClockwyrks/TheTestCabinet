// pointer/almanac-shown-tab-click-inert — a click on the tab already showing
// keeps the reader's place in the list.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 2: "a
// click inside the rectangle of a tab the almanac is not showing selects that
// tab exactly as `right` reaching it does, and a click inside the shown tab's
// rectangle changes nothing". specs/ui.md ("`almanac`") states what a tab change
// costs: it "set[s] `menuIndex` and `almanacScroll` to `0`", so "changes
// nothing" is decided by the two indices a tab change would have reset.
// specs/instrumentation.md ("Menus") fixes the order the rectangles come in:
// "one per tab in `ALMANAC_TABS` order", so the first rectangle is the tab the
// almanac is entered showing.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `almanacTab`, `menuIndex` and
// `almanacScroll` off the snapshot the clicking frame left. The highlight is
// moved off `0` first, because on a tab entered with every index at `0` a build
// that reset them and one that left them alone would read the same.
//
// HOW THE SCENARIO IS DRIVEN. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md defines as "exactly as
// confirming `THE ALMANAC` does: the idle run, `menuIndex` `0`, `almanacTab`
// `0`, `almanacScroll` `0`", so the first tab is the shown one. The highlight is
// moved to the fifth entry with real `down` presses, which leaves `almanacScroll`
// at `0` because "the greater of that and `menuIndex − ALMANAC_ROWS + 1`" is
// below `0` for an index under `ALMANAC_ROWS` (`10`). The primary button is then
// pressed at the middle of the FIRST rectangle `tabRects()` reports, with exactly
// one frame between press and release.
//
// THE TOLERANCE. None: a screen name and three indices are exact comparisons,
// and the aim is inside the rectangle by construction.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, clickAt, createHarness, type Harness } from "../harness";
import { highlightEntry, poseAlmanac, tabPoints } from "./stage";

/** The tab the click lands in: the first of `ALMANAC_TABS`, the one being shown. */
const SHOWN = 0;

/** Where the entry highlight stands, far enough from `0` for a reset to show. */
const HIGHLIGHTED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds almanacTab 0 with menuIndex 4 and almanacScroll 0 after a click on the shown tab", async () => {
  await poseAlmanac(h);
  const posed = await highlightEntry(h, HIGHLIGHTED);
  assertEqual(
    posed.almanacScroll,
    0,
    "almanacScroll with the highlight inside the first window of rows",
  );
  const points = await tabPoints(h, "for the almanac's tab bar");

  const clicked = await clickAt(h, points[SHOWN]!);
  await captureStill(h, "shown");

  assertEqual(clicked.screen, "almanac", "the screen the click left");
  assertEqual(
    clicked.almanacTab,
    SHOWN,
    "almanacTab after a click inside the shown tab's rectangle",
  );
  assertEqual(
    clicked.menuIndex,
    HIGHLIGHTED,
    "menuIndex after a click inside the shown tab's rectangle",
  );
  assertEqual(
    clicked.almanacScroll,
    0,
    "almanacScroll after a click inside the shown tab's rectangle",
  );
});
