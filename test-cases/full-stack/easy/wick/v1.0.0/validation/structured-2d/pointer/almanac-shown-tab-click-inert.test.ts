// Wick — pointer/almanac-shown-tab-click-inert: a click on the tab the almanac
// is already showing changes nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 2, Click: "a click inside the rectangle of a tab the almanac is not
// showing selects that tab exactly as `right` reaching it does, and a click
// inside the shown tab's rectangle changes nothing." `specs/ui.md`,
// "`almanac`", makes a tab change "set `menuIndex` and `almanacScroll` to `0`",
// so a build that treats the shown tab's rectangle as a selection throws the
// reader back to the top of the list, which is exactly what this reads.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `almanacTab`, `menuIndex`, and
// `almanacScroll` after the clicking frame. The highlight is posed on the fifth
// entry of the `TOOLS` tab first: with the highlight at `0` a re-selection
// would be indistinguishable from doing nothing, and with it posed the reader's
// place in the list is the thing the rule protects.
//
// WHY THE SCROLL STAYS 0 WHEN POSED. `specs/ui.md`: "The list shows
// `ALMANAC_ROWS` (`10`) entries at a time", and `almanacScroll` follows the
// highlight only as far as "the greater of that and `menuIndex − ALMANAC_ROWS
// + 1`", so an entry inside the first window leaves the scroll at `0`.
//
// THE DRIVE. `setScreen("almanac")` — "exactly as confirming `THE ALMANAC`
// does" (`specs/instrumentation.md`) — four real `ArrowDown` presses onto the
// fifth entry, then a primary press and release in the middle of the FIRST
// tab's own rectangle, read off `tabRects`, which is the tab `almanacTab` `0`
// already shows.
//
// THE TOLERANCE. None: three indices and a screen name.

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

/** The index of TOOLS, the tab the almanac opens on (specs/ui.md). */
const SHOWN_TAB = 0;
/** The entry the highlight is posed on before the click. */
const POSED_ENTRY = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds almanacTab 0, menuIndex 4 and almanacScroll 0 after a click on the shown tab", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the click is made on");
  assertEqual(opened.almanacTab, SHOWN_TAB, "the tab the almanac opens on");

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

  const after = await clickRect(h, tabs[SHOWN_TAB]);
  captureStill(h, "shown");

  assertEqual(after.screen, "almanac", "the screen the click left");
  assertEqual(
    after.almanacTab,
    SHOWN_TAB,
    "the tab after a click on the tab already shown (specs/controls.md, Click)",
  );
  assertEqual(
    after.menuIndex,
    POSED_ENTRY,
    "the entry the reader was on, kept (specs/controls.md, Click)",
  );
  assertEqual(
    after.almanacScroll,
    0,
    "the list's first visible row, kept (specs/controls.md, Click)",
  );
});
