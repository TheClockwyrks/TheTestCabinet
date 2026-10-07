// Wick — pointer/almanac-tab-touch-selects: a contact landing and lifting in a
// tab's rectangle selects that tab.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "the almanac's entry rows and its tab rectangles answer a
// contact exactly as they answer a press and a release", and rule 2 for a tab:
// "a press and release inside the rectangle of a tab the almanac is not showing
// selects that tab exactly as `right` reaching it does." `specs/ui.md`,
// "`almanac`": `left` and `right` "move `almanacTab` by one over `ALMANAC_TABS`,
// wrap at both ends, and set `menuIndex` and `almanacScroll` to `0`."
//
// WHY THIS IS ITS OWN POINT. The tab bar is the almanac's whole navigation, so
// a build that answers no contact there leaves a touch player on the first tab.
// The mouse's route is `pointer/almanac-tab-click-selects`'.
//
// WHAT IS READ. The tab, the highlight, and the window after the gesture. The
// highlight is posed off zero first, so the reset the tab change owes is
// visible.
//
// THE DRIVE. `reset`, `setScreen("almanac")`, real `down` presses onto an entry,
// and a contact landing at the middle of the THIRD tab's rectangle and lifting
// there. The third is a tab the almanac is not showing, which is the case the
// rule fixes.
//
// THE TOLERANCE. None: a screen name and three indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  tabRects,
  touchTapRect,
  type Harness,
} from "../harness";
import { moveHighlight } from "./pointing";

/** The index of ENEMIES, the third tab of ALMANAC_TABS (specs/ui.md). */
const THIRD_TAB = 2;

/** The entry the highlight is posed on before the contact. */
const POSED_ENTRY = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads almanacTab 2 with menuIndex and almanacScroll 0 after a contact on the third tab", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the contact lands on");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on, TOOLS");

  const posed = await moveHighlight(h, POSED_ENTRY);
  assertEqual(
    posed.menuIndex,
    POSED_ENTRY,
    "the entry posed before the contact",
  );

  const tabs = tabRects(h);
  assertLength(tabs, ALMANAC_TABS.length, "the tab bar's rectangles");

  const after = await touchTapRect(h, tabs[THIRD_TAB]);
  captureStill(h, "tab");

  assertEqual(after.screen, "almanac", "the screen the contact left");
  assertEqual(after.almanacTab, THIRD_TAB, "the tab the contact selected");
  assertEqual(after.menuIndex, 0, "menuIndex after the tab change");
  assertEqual(after.almanacScroll, 0, "almanacScroll after the tab change");
});
