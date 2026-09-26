// Wick — screens/almanac-lists-enemies: the `ENEMIES` tab lists all thirteen
// enemy names, in order, ten rows at a time.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`", gives
// the `ENEMIES` tab "the thirteen of `ENEMY_IDS`", in that order, and each
// entry's name as "The ... enemy's from `ENEMIES`". "The list shows
// `ALMANAC_ROWS` (`10`) entries at a time, beginning at the entry at
// `almanacScroll` ... Each row shows its entry's name."
//
// WHAT IS READ. The names the frame drew and the order it drew them down the
// stage, over the two windows that together cover all thirteen: the window the
// tab opens on, rows `0` to `9`, and the window the highlight on the last
// entry leaves, rows `3` to `12`. Where the list sits, its pitch, and the type
// it is set in are the build's (`specs/ui.md`, Presentation), so the reading
// is which names appeared and which of them sits above which. A name is
// matched as a SUBSTRING, so a build that marks the highlighted row or pads
// its rows still reads as having drawn it.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, two
// `ArrowRight` presses onto the third tab, which sets `menuIndex` and
// `almanacScroll` to `0`, one frame read there; then twelve `ArrowDown`
// presses onto the last entry, which the scroll rule carries to
// `almanacScroll` `3`, and one more frame. The scroll is read from the
// snapshot before each frame is judged.
//
// THE TOLERANCE. The names are exact, ignoring case and surrounding
// characters. The order is strict: each name is drawn strictly below the one
// before it, since two rows drawn at one height are not a list.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { ALMANAC_ENTRY_COUNTS, ALMANAC_ROWS, ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  placedRuns,
  type Harness,
} from "../harness";
import { moveEntry, moveTab, outOfOrder, windowNames } from "./almanac";

/** The tab read, where it sits on the bar, and the last entry of its thirteen. */
const TAB = "ENEMIES";
const AT = ALMANAC_TABS.indexOf(TAB);
const LAST = ALMANAC_ENTRY_COUNTS[TAB] - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the thirteen enemy names in order over the two windows", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const opened = await moveTab(h, AT);
  assertEqual(opened.almanacTab, AT, "the tab the almanac is showing");
  assertEqual(opened.almanacScroll, 0, "the list's first visible row");

  const first = await h.frameDraw();
  captureStill(h, "enemies");
  const top = windowNames(TAB, opened.almanacScroll);
  assertEqual(top.length, ALMANAC_ROWS, "rows the first window shows");
  assertNull(
    outOfOrder(placedRuns(first.calls), top),
    `the first name the first window drew out of ${TAB} order, of ${top.join(", ")} (specs/ui.md, almanac)`,
  );

  const walked = await moveEntry(h, LAST);
  assertEqual(walked.menuIndex, LAST, "menuIndex on the last enemy entry");
  assertEqual(
    walked.almanacScroll,
    ALMANAC_ENTRY_COUNTS[TAB] - ALMANAC_ROWS,
    "the list's first visible row with the last entry highlighted",
  );

  const second = await h.frameDraw();
  const end = windowNames(TAB, walked.almanacScroll);
  assertEqual(end.length, ALMANAC_ROWS, "rows the last window shows");
  assertNull(
    outOfOrder(placedRuns(second.calls), end),
    `the first name the last window drew out of ${TAB} order, of ${end.join(", ")} (specs/ui.md, almanac)`,
  );
});
