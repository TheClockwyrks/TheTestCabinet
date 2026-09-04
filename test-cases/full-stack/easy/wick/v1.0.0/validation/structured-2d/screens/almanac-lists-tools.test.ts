// Wick — screens/almanac-lists-tools: the `TOOLS` tab lists all sixteen weapon
// names, in order, ten rows at a time.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`", gives
// the `TOOLS` tab "the ten of `BASE_WEAPON_IDS`, then the six of
// `EVOLUTION_IDS`", in that order, and each entry's name as "The weapon's from
// `WEAPON_NAMES`". "The list shows `ALMANAC_ROWS` (`10`) entries at a time,
// beginning at the entry at `almanacScroll` ... Each row shows its entry's
// name."
//
// WHAT IS READ. The names the frame drew and the order it drew them down the
// stage, over the two windows that together cover all sixteen: the window the
// screen opens on, rows `0` to `9`, and the window the highlight on the last
// entry leaves, rows `6` to `15`. Where the list sits, its pitch, and the type
// it is set in are the build's (`specs/ui.md`, Presentation), so the reading
// is which names appeared and which of them sits above which. A name is
// matched as a SUBSTRING, so a build that marks the highlighted row or pads
// its rows still reads as having drawn it.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it on the first tab with `menuIndex` and `almanacScroll` `0`, one
// frame read there; then fifteen `ArrowDown` presses onto the last entry,
// which the scroll rule carries to `almanacScroll` `6`, and one more frame.
// The scroll is read from the snapshot before each frame is judged, so the
// window a frame is held to is the window the build says it is showing.
//
// THE TOLERANCE. The names are exact, ignoring case and surrounding
// characters. The order is strict: each name is drawn strictly below the one
// before it, since two rows drawn at one height are not a list.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { ALMANAC_ENTRY_COUNTS, ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  textDraws,
  type Harness,
} from "../harness";
import { moveEntry, outOfOrder, windowNames } from "./almanac";

/** The tab read, and the last entry of its sixteen. */
const TAB = "TOOLS";
const LAST = ALMANAC_ENTRY_COUNTS[TAB] - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the sixteen weapon names in order over the two windows", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on");
  assertEqual(opened.almanacScroll, 0, "the list's first visible row");

  const first = await h.frameDraw();
  captureStill(h, "tools");
  const top = windowNames(TAB, opened.almanacScroll);
  assertEqual(top.length, ALMANAC_ROWS, "rows the first window shows");
  assertNull(
    outOfOrder(textDraws(first.calls), top),
    `the first name the first window drew out of ${TAB} order, of ${top.join(", ")} (specs/ui.md, almanac)`,
  );

  const walked = await moveEntry(h, LAST);
  assertEqual(walked.menuIndex, LAST, "menuIndex on the last tools entry");
  assertEqual(
    walked.almanacScroll,
    ALMANAC_ENTRY_COUNTS[TAB] - ALMANAC_ROWS,
    "the list's first visible row with the last entry highlighted",
  );

  const second = await h.frameDraw();
  const end = windowNames(TAB, walked.almanacScroll);
  assertEqual(end.length, ALMANAC_ROWS, "rows the last window shows");
  assertNull(
    outOfOrder(textDraws(second.calls), end),
    `the first name the last window drew out of ${TAB} order, of ${end.join(", ")} (specs/ui.md, almanac)`,
  );
});
