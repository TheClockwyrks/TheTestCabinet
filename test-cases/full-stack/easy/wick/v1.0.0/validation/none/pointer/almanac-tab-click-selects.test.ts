// pointer/almanac-tab-click-selects — a click inside a tab's rectangle selects
// that tab.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"): "On
// `almanac` each tab of the tab bar occupies a rectangle as well, disjoint from
// every entry rectangle", and rule 2: "a click inside the rectangle of a tab the
// almanac is not showing selects that tab exactly as `right` reaching it does".
// specs/ui.md ("`almanac`") fixes what `right` reaching a tab does: "`left` and
// `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends, and
// set `menuIndex` and `almanacScroll` to `0`". specs/instrumentation.md
// ("Menus") fixes the order the rectangles come in: "one per tab in
// `ALMANAC_TABS` order", so the third rectangle is `almanacTab` `2`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `almanacTab` off the snapshot,
// with `menuIndex` and `almanacScroll` beside it, because "exactly as `right`
// reaching it does" is the whole of what the click leaves. The entry highlight
// is moved off `0` before the click, so a build that changed the tab without
// resetting the reader's place in the list is told apart from one that did both.
//
// HOW THE SCENARIO IS DRIVEN. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md defines as setting
// `screen` alone, "with `menuIndex`, `almanacTab`, and `almanacScroll`
// all `0`", so the shown tab is the first and the third is one
// the almanac is not showing. The highlight is then moved with real `down`
// presses, and the primary button is pressed at the middle of the third
// rectangle `tabRects()` reports, with exactly one frame between press and
// release.
//
// THE TOLERANCE. None: a screen name and three indices are exact comparisons,
// and the aim is inside the rectangle by construction.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, clickAt, createHarness, type Harness } from "../harness";
import { highlightEntry, poseAlmanac, tabPoints } from "./stage";

/** The tab the click lands in: the third of `ALMANAC_TABS`, which is not the shown one. */
const CLICKED = 2;

/** Where the entry highlight stands before the click, so the reset is visible. */
const HIGHLIGHTED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads almanacTab 2 with the list back at its start after a click on the third tab", async () => {
  await poseAlmanac(h);
  await highlightEntry(h, HIGHLIGHTED);
  const points = await tabPoints(h, "for the almanac's tab bar");

  const selected = await clickAt(h, points[CLICKED]!);
  await captureStill(h, "tab");

  assertEqual(selected.screen, "almanac", "the screen the tab click left");
  assertEqual(
    selected.almanacTab,
    CLICKED,
    "almanacTab after a click inside the third tab's rectangle",
  );
  assertEqual(selected.menuIndex, 0, "menuIndex after the tab change");
  assertEqual(selected.almanacScroll, 0, "almanacScroll after the tab change");
});
