// Wick — pointer/almanac-entry-click-highlights: a click on an almanac entry
// moves the highlight and no more.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 2, Click: "On `almanac` an entry carries no `confirm`, so a click on an
// entry only moves the highlight". The rectangles are the ones the same section
// fixes: "On `almanac` it is the visible entry rows, at most `ALMANAC_ROWS` of
// them, and the rectangle at position `i` belongs to the entry at `menuIndex`
// `almanacScroll + i`." `specs/ui.md`, "`almanac`", puts `menuIndex`,
// `almanacTab`, and `almanacScroll` all at `0` on arriving and says "`confirm`
// and `pause` do nothing here", so the third visible row is the entry at
// `menuIndex` `2` and clicking it leads nowhere.
//
// WHY THE LIST HOLDS TEN ROWS. `specs/ui.md` gives the `TOOLS` tab sixteen
// entries, "the ten of `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", and
// "The list shows `ALMANAC_ROWS` (`10`) entries at a time", so the window at
// `almanacScroll` `0` is ten rows.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` for the move and
// `screen` for what the click did NOT do: a build that wired the almanac's rows
// to the same confirm the title's items carry leaves `almanac` here and fails.
//
// THE DRIVE. `setScreen("almanac")` — "exactly as confirming `THE ALMANAC`
// does" (`specs/instrumentation.md`) — and a primary press and release in the
// middle of the third visible row's own rectangle, read off `menuRects`, before
// the frame that reads the edge.
//
// THE TOLERANCE. None: two indices and a screen name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  menuRects,
  poseScreen,
  type Harness,
} from "../harness";

/** The position of the third row of the visible window. */
const THIRD_ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 2 with the screen still almanac after a click on the third row", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the click is made on");
  assertEqual(opened.menuIndex, 0, "menuIndex on arriving at the almanac");
  assertEqual(opened.almanacScroll, 0, "the list's first visible row");

  const rects = menuRects(h);
  assertLength(
    rects,
    ALMANAC_ROWS,
    "the list's rectangles, one per visible row (specs/ui.md, almanac)",
  );

  const after = await clickRect(h, rects[THIRD_ROW]);
  captureStill(h, "clicked");

  assertEqual(
    after.screen,
    "almanac",
    "the screen after a click on an entry (specs/controls.md, Click)",
  );
  assertEqual(
    after.menuIndex,
    THIRD_ROW,
    "menuIndex after a click on the third visible row (specs/controls.md, Click)",
  );
  assertEqual(after.almanacTab, 0, "the tab the click left the almanac on");
});
