// Wick — pointer/almanac-tab-click-selects: a click on a tab the almanac is
// not showing selects that tab.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer:
// "On `almanac` each tab of the tab bar occupies a rectangle as well, disjoint
// from every entry rectangle." Rule 2, Click: "a click inside the rectangle of
// a tab the almanac is not showing selects that tab exactly as `right` reaching
// it does". `specs/ui.md`, "`almanac`", gives the tab bar `ALMANAC_TABS`
// (`TOOLS`, `TRINKETS`, `ENEMIES`, `PICKUPS`, "in that order") and says
// "`left` and `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at
// both ends, and set `menuIndex` and `almanacScroll` to `0`", so the third tab
// is `almanacTab` `2` and reaching it leaves both indices at `0`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `almanacTab` for the selection,
// and `menuIndex` and `almanacScroll` for the "exactly as `right` reaching it
// does" the rule spells: a build that swaps the tab and leaves the reader
// halfway down the previous tab's list fails. The highlight is posed OFF `0`
// first, so that half of the reading can fail at all.
//
// THE DRIVE. `setScreen("almanac")` — "exactly as confirming `THE ALMANAC`
// does: the idle run, `menuIndex` `0`, `almanacTab` `0`, `almanacScroll` `0`"
// (`specs/instrumentation.md`) — then three real `ArrowDown` presses onto the
// fourth entry of the `TOOLS` tab, which is inside the first window of
// `ALMANAC_ROWS` (`10`) rows and so leaves `almanacScroll` at `0`. Then a
// primary press and release in the middle of the third tab's own rectangle,
// read off `tabRects`, before the frame that reads the edge. The point is the
// build's own: the specification fixes no layout for the tab bar.
//
// THE TOLERANCE. None: three indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  poseScreen,
  tabRects,
  type Harness,
} from "../harness";
import { moveHighlight } from "./pointing";

/** The index of ENEMIES, the third tab of ALMANAC_TABS (specs/ui.md). */
const THIRD_TAB = 2;
/** The entry the highlight is posed on before the click. */
const POSED_ENTRY = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads almanacTab 2 with menuIndex and almanacScroll 0 after a click on the third tab", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the click is made on");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on, TOOLS");

  const posed = await moveHighlight(h, POSED_ENTRY);
  assertEqual(posed.menuIndex, POSED_ENTRY, "the entry posed before the click");
  assertEqual(
    posed.almanacScroll,
    0,
    "the list's first visible row when posed",
  );

  const tabs = tabRects(h);
  assertLength(
    tabs,
    ALMANAC_TABS.length,
    "the tab bar's rectangles, one per tab (specs/controls.md, The pointer)",
  );

  const after = await clickRect(h, tabs[THIRD_TAB]);
  captureStill(h, "tab");

  assertEqual(after.screen, "almanac", "the screen the click left");
  assertEqual(
    after.almanacTab,
    THIRD_TAB,
    "the tab a click on the third tab selects (specs/controls.md, Click)",
  );
  assertEqual(
    after.menuIndex,
    0,
    "menuIndex after the tab change (specs/ui.md, almanac)",
  );
  assertEqual(
    after.almanacScroll,
    0,
    "the list's first visible row after the tab change (specs/ui.md, almanac)",
  );
});
